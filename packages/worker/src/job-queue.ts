/**
 * Durable job queue (ADR-002).
 *
 * Replaces in-process retries, which are lost whenever the process exits — a
 * deploy, a crash, an OOM kill or a node drain silently drops the work. For
 * settlement and webhook delivery that is data loss: a merchant never learns about
 * a payment it was owed.
 *
 * Why Postgres rather than Redis: a job can be enqueued in the SAME transaction as
 * the state change that caused it, so the queue and the payment intent state
 * machine cannot disagree. A separate broker would reintroduce a dual-write
 * consistency problem in the code path where correctness matters most.
 *
 * Delivery is at-least-once. Exactly-once is achieved by the handler being
 * idempotent plus the unique index on `idempotency_key`, not by the queue.
 */

import { query, transaction, type PoolClient } from '@crypto-gateway/db';
import { JobHandlerMissingError } from './errors.js';

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTERED';

export const DEFAULT_QUEUE = 'default';

export interface JobRecord {
  id: string;
  queue: string;
  jobType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
}

export type JobHandler = (job: JobRecord) => Promise<void>;

/**
 * Minimal database surface the queue needs.
 *
 * Narrowing this to `query` keeps the queue testable without a live database and
 * lets callers pass whichever client is inside their current transaction.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface EnqueueOptions {
  jobType: string;
  payload: Record<string, unknown>;
  /** Logical identity of the work. Enqueueing the same work twice is a no-op. */
  idempotencyKey: string;
  queue?: string;
  maxAttempts?: number;
  delayMs?: number;
  /**
   * Enqueue inside an existing transaction. Pass the client from the transaction
   * that performs the state change so both commit or neither does.
   */
  client?: Queryable;
}

export interface JobQueueOptions {
  workerId: string;
  pollIntervalMs: number;
  concurrency: number;
  defaultMaxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  visibilityTimeoutMs: number;
}

export interface JobQueueStats {
  pending: number;
  running: number;
  succeeded: number;
  deadLettered: number;
}

/**
 * Backoff for the given attempt number, using equal jitter.
 *
 * Half the delay is deterministic and half is random. Full jitter can return
 * delays near zero, which lets a failing dependency be hammered; no jitter makes
 * every worker retry in lockstep. Equal jitter avoids both.
 *
 * @param attempt 1-based attempt number that just failed.
 * @param random injectable for deterministic tests.
 * @returns delay in milliseconds, always >= 1.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const half = Math.max(1, Math.floor(exponential / 2));
  return half + Math.floor(random() * half);
}

/** Shape of a `jobs` row as Postgres returns it. */
interface JobRow {
  id: string;
  queue: string;
  job_type: string;
  payload: unknown;
  idempotency_key: string;
  status: string;
  attempt_count: number | string;
  max_attempts: number | string;
  run_at: string | Date;
  last_error: string | null;
}

function mapJobRow(row: JobRow): JobRecord {
  return {
    id: String(row.id),
    queue: String(row.queue),
    jobType: String(row.job_type),
    payload:
      typeof row.payload === 'string'
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : ((row.payload ?? {}) as Record<string, unknown>),
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as JobStatus,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    runAt: new Date(row.run_at),
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly options: JobQueueOptions;

  constructor(options: JobQueueOptions) {
    this.options = options;
  }

  /**
   * Register the handler for a job type.
   * Registering the same type twice is a programming error and throws.
   */
  registerHandler(jobType: string, handler: JobHandler): void {
    if (this.handlers.has(jobType)) {
      throw new Error(`Handler already registered for job type "${jobType}"`);
    }
    this.handlers.set(jobType, handler);
  }

  getRegisteredJobTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Enqueue a job. Safe to call repeatedly with the same idempotency key.
   *
   * @returns true if the job was created, false if it already existed.
   */
  async enqueue(options: EnqueueOptions): Promise<boolean> {
    const {
      jobType,
      payload,
      idempotencyKey,
      queue: queueName = DEFAULT_QUEUE,
      maxAttempts = this.options.defaultMaxAttempts,
      delayMs = 0,
      client,
    } = options;

    const sql = `INSERT INTO jobs (queue, job_type, payload, idempotency_key, max_attempts, run_at)
                 VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' milliseconds')::interval)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING id`;

    const params = [
      queueName,
      jobType,
      JSON.stringify(payload),
      idempotencyKey,
      maxAttempts,
      delayMs,
    ];

    if (client) {
      const result = await client.query(sql, params);
      return result.rows.length > 0;
    }

    const result = await query<{ id: string }>(sql, params);
    return result.rowCount > 0;
  }

  /**
   * Claim up to `limit` runnable jobs.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe: each claims a
   * disjoint set without blocking on rows another worker holds.
   */
  async claimBatch(limit: number, queueName: string = DEFAULT_QUEUE): Promise<JobRecord[]> {
    const result = await query<JobRow>(
      `WITH claimed AS (
         SELECT id FROM jobs
         WHERE queue = $1 AND status = 'PENDING' AND run_at <= NOW()
         ORDER BY run_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j
       SET status = 'RUNNING',
           locked_at = NOW(),
           locked_by = $3,
           attempt_count = j.attempt_count + 1,
           updated_at = NOW()
       FROM claimed
       WHERE j.id = claimed.id
       RETURNING j.*`,
      [queueName, limit, this.options.workerId],
    );
    return result.rows.map(mapJobRow);
  }

  /** Mark a job as completed. */
  async complete(jobId: string): Promise<void> {
    await query(
      `UPDATE jobs
       SET status = 'SUCCEEDED', completed_at = NOW(), updated_at = NOW(),
           locked_at = NULL, locked_by = NULL, last_error = NULL
       WHERE id = $1`,
      [jobId],
    );
  }

  /**
   * Record a failure and either schedule a retry or dead-letter the job.
   *
   * Dead-lettering is explicit and queryable, never silent: work that needs a human
   * must be findable, not retried forever.
   */
  async fail(job: JobRecord, error: unknown, delayMs?: number): Promise<'retry' | 'dead_letter'> {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // Keep the message bounded; last_error is for operators, not a stack dump.
    const truncated = message.slice(0, 2000);

    if (job.attemptCount >= job.maxAttempts) {
      await query(
        `UPDATE jobs
         SET status = 'DEAD_LETTERED', completed_at = NOW(), updated_at = NOW(),
             locked_at = NULL, locked_by = NULL, last_error = $2
         WHERE id = $1`,
        [job.id, truncated],
      );
      return 'dead_letter';
    }

    const delay =
      delayMs ??
      computeBackoffMs(job.attemptCount, this.options.backoffBaseMs, this.options.backoffMaxMs);

    await query(
      `UPDATE jobs
       SET status = 'PENDING', run_at = NOW() + ($2 || ' milliseconds')::interval,
           updated_at = NOW(), locked_at = NULL, locked_by = NULL, last_error = $3
       WHERE id = $1`,
      [job.id, delay, truncated],
    );
    return 'retry';
  }

  /**
   * Return jobs abandoned by a worker that died mid-execution.
   *
   * Without this a crash would leave jobs stuck in RUNNING forever, which is
   * functionally the same as losing them.
   */
  async reclaimStale(): Promise<number> {
    const result = await query(
      `UPDATE jobs
       SET status = 'PENDING', run_at = NOW(), updated_at = NOW(),
           locked_at = NULL, locked_by = NULL,
           last_error = COALESCE(last_error || ' | ', '') || 'reclaimed after visibility timeout'
       WHERE status = 'RUNNING'
         AND locked_at < NOW() - ($1 || ' milliseconds')::interval`,
      [this.options.visibilityTimeoutMs],
    );
    return result.rowCount;
  }

  /**
   * Claim and process one batch.
   *
   * @returns number of jobs processed.
   */
  async runOnce(queueName: string = DEFAULT_QUEUE): Promise<number> {
    const batch = await this.claimBatch(this.options.concurrency, queueName);

    for (const job of batch) {
      const handler = this.handlers.get(job.jobType);

      if (!handler) {
        // A missing handler is a deployment fault, not a transient error. Dead-letter
        // immediately so it is visible instead of being retried until the attempts run out.
        await this.fail(
          { ...job, attemptCount: job.maxAttempts },
          new JobHandlerMissingError(job.jobType),
        );
        continue;
      }

      try {
        await handler(job);
        await this.complete(job.id);
      } catch (error) {
        await this.fail(job, error);
      }
    }

    return batch.length;
  }

  /**
   * Poll until aborted. Reclaims stale jobs on every cycle so a crashed peer's
   * work is recovered without operator intervention.
   */
  async run(
    signal: AbortSignal,
    options: { queueName?: string; onCycle?: (processed: number) => void } = {},
  ): Promise<void> {
    const queueName = options.queueName ?? DEFAULT_QUEUE;

    while (!signal.aborted) {
      await this.reclaimStale();
      const processed = await this.runOnce(queueName);
      options.onCycle?.(processed);

      if (signal.aborted) break;
      await sleep(this.options.pollIntervalMs, signal);
    }
  }

  async stats(): Promise<JobQueueStats> {
    const result = await query<{ status: JobStatus; count: string }>(
      `SELECT status, COUNT(*) as count FROM jobs GROUP BY status`,
    );

    const stats: JobQueueStats = { pending: 0, running: 0, succeeded: 0, deadLettered: 0 };
    for (const row of result.rows) {
      const count = Number.parseInt(row.count, 10);
      if (row.status === 'PENDING' || row.status === 'FAILED') stats.pending += count;
      else if (row.status === 'RUNNING') stats.running += count;
      else if (row.status === 'SUCCEEDED') stats.succeeded += count;
      else if (row.status === 'DEAD_LETTERED') stats.deadLettered += count;
    }
    return stats;
  }

  /** Work that needs a human. Surfaced on /metrics and by alerting. */
  async deadLetters(limit = 50): Promise<JobRecord[]> {
    const result = await query<JobRow>(
      `SELECT * FROM jobs WHERE status = 'DEAD_LETTERED' ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapJobRow);
  }

  /**
   * Run `fn` inside a transaction, giving it a queue bound to that transaction so
   * the job and the state change commit together.
   */
  async withTransaction<T>(fn: (txQueue: Queryable) => Promise<T>): Promise<T> {
    return transaction(async (client: PoolClient) => fn(client as Queryable));
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
