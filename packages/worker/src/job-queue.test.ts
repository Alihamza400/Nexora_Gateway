import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, transactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@crypto-gateway/db', () => ({
  query: (...args: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> =>
    queryMock(...args) as Promise<{ rows: unknown[]; rowCount: number }>,
  transaction: (...args: unknown[]): Promise<unknown> =>
    transactionMock(...args) as Promise<unknown>,
}));

import { JobQueue, computeBackoffMs, DEFAULT_QUEUE } from './job-queue.js';
import type { JobRecord } from './job-queue.js';

function makeQueue(overrides: Partial<ConstructorParameters<typeof JobQueue>[0]> = {}): JobQueue {
  return new JobQueue({
    workerId: 'test-worker',
    pollIntervalMs: 1000,
    concurrency: 2,
    defaultMaxAttempts: 5,
    backoffBaseMs: 1000,
    backoffMaxMs: 60000,
    visibilityTimeoutMs: 30000,
    ...overrides,
  });
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    queue: DEFAULT_QUEUE,
    jobType: 'deposit.record',
    payload: {},
    idempotencyKey: 'key-1',
    status: 'RUNNING',
    attemptCount: 1,
    maxAttempts: 5,
    runAt: new Date(),
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
});

describe('computeBackoffMs', () => {
  it('grows exponentially with the attempt number', () => {
    const noJitter = () => 0;
    expect(computeBackoffMs(1, 1000, 60000, noJitter)).toBe(500);
    expect(computeBackoffMs(2, 1000, 60000, noJitter)).toBe(1000);
    expect(computeBackoffMs(3, 1000, 60000, noJitter)).toBe(2000);
  });

  it('never exceeds the configured ceiling', () => {
    // maxMs caps the exponential term before jitter is applied.
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(computeBackoffMs(attempt, 1000, 5000, () => 1)).toBeLessThanOrEqual(5000);
    }
  });

  it('applies jitter so retries do not arrive in lockstep', () => {
    const low = computeBackoffMs(4, 1000, 60000, () => 0);
    const high = computeBackoffMs(4, 1000, 60000, () => 0.999);
    expect(high).toBeGreaterThan(low);
  });

  it('always returns a positive delay so a retry cannot spin', () => {
    expect(computeBackoffMs(1, 1, 1, () => 0)).toBeGreaterThanOrEqual(1);
  });

  it('treats attempt numbers below 1 as the first attempt', () => {
    expect(computeBackoffMs(0, 1000, 60000, () => 0)).toBe(500);
  });
});

describe('JobQueue.enqueue', () => {
  it('is idempotent by key: a duplicate enqueue reports no insert', async () => {
    const queue = makeQueue();
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const created = await queue.enqueue({
      jobType: 'deposit.record',
      payload: { intentId: 'i-1' },
      idempotencyKey: 'deposit:1:0xabc',
      client,
    });

    expect(created).toBe(false);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(params).toContain('deposit:1:0xabc');
  });

  it('reports a create when the row was inserted', async () => {
    const queue = makeQueue();
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'job-1' }] }) };

    const created = await queue.enqueue({
      jobType: 'deposit.record',
      payload: {},
      idempotencyKey: 'unique',
      client,
    });

    expect(created).toBe(true);
  });

  it('defaults to the default queue and applies the delay', async () => {
    const queue = makeQueue({ defaultMaxAttempts: 7 });
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'job-1' }] }) };

    await queue.enqueue({
      jobType: 'deposit.record',
      payload: {},
      idempotencyKey: 'k',
      delayMs: 2500,
      client,
    });

    const [, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(DEFAULT_QUEUE);
    expect(params[4]).toBe(7);
    expect(params[5]).toBe(2500);
  });
});

describe('JobQueue.claimBatch', () => {
  it('maps database rows to job records', async () => {
    const queue = makeQueue();
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'job-9',
          queue: 'deposits',
          job_type: 'deposit.record',
          payload: '{"intentId":"i-1"}',
          idempotency_key: 'k',
          status: 'RUNNING',
          attempt_count: 2,
          max_attempts: 5,
          run_at: new Date('2026-01-01T00:00:00Z'),
          last_error: null,
        },
      ],
    });

    const [job] = await queue.claimBatch(2);

    expect(job?.jobType).toBe('deposit.record');
    expect(job?.payload).toEqual({ intentId: 'i-1' });
    expect(job?.attemptCount).toBe(2);
  });

  it('claims with SKIP LOCKED so concurrent workers do not collide', async () => {
    const queue = makeQueue();
    queryMock.mockResolvedValue({ rows: [] });

    await queue.claimBatch(5);

    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'PENDING'");
  });
});

describe('JobQueue.fail', () => {
  it('reschedules while attempts remain', async () => {
    const queue = makeQueue();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    const outcome = await queue.fail(
      makeJob({ attemptCount: 2, maxAttempts: 5 }),
      new Error('boom'),
    );

    expect(outcome).toBe('retry');
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'PENDING'");
    expect(params[2]).toContain('boom');
  });

  it('dead-letters once attempts are exhausted, so the work is visible', async () => {
    const queue = makeQueue();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    const outcome = await queue.fail(
      makeJob({ attemptCount: 5, maxAttempts: 5 }),
      new Error('exhausted'),
    );

    expect(outcome).toBe('dead_letter');
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain("status = 'DEAD_LETTERED'");
  });

  it('bounds the stored error message', async () => {
    const queue = makeQueue();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    await queue.fail(makeJob(), new Error('x'.repeat(5000)));

    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(String(params[1]).length).toBeLessThanOrEqual(2000);
  });
});

describe('JobQueue.runOnce', () => {
  it('runs a registered handler and marks the job succeeded', async () => {
    const queue = makeQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.registerHandler('deposit.record', handler);

    queryMock
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 }) // claimBatch
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // complete

    const processed = await queue.runOnce();

    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(String((queryMock.mock.calls[1] as [string])[0])).toContain("status = 'SUCCEEDED'");
  });

  it('reschedules when the handler throws', async () => {
    const queue = makeQueue();
    queue.registerHandler('deposit.record', vi.fn().mockRejectedValue(new Error('transient')));

    queryMock
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await queue.runOnce();

    expect(String((queryMock.mock.calls[1] as [string])[0])).toContain("status = 'PENDING'");
  });

  it('dead-letters a job whose handler was never registered', async () => {
    const queue = makeQueue();
    queryMock
      .mockResolvedValueOnce({ rows: [row()], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await queue.runOnce();

    const [sql] = queryMock.mock.calls[1] as [string];
    expect(sql).toContain("status = 'DEAD_LETTERED'");
  });

  it('rejects a duplicate handler registration', () => {
    const queue = makeQueue();
    queue.registerHandler('a', vi.fn());
    expect(() => queue.registerHandler('a', vi.fn())).toThrow(/already registered/);
  });
});

describe('JobQueue.reclaimStale', () => {
  it('returns jobs abandoned by a dead worker to the pending queue', async () => {
    const queue = makeQueue({ visibilityTimeoutMs: 120000 });
    queryMock.mockResolvedValue({ rows: [], rowCount: 3 });

    const reclaimed = await queue.reclaimStale();

    expect(reclaimed).toBe(3);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'RUNNING'");
    expect(params[0]).toBe(120000);
  });
});

describe('JobQueue.stats', () => {
  it('aggregates counts by status and folds FAILED into pending', async () => {
    const queue = makeQueue();
    queryMock.mockResolvedValue({
      rows: [
        { status: 'PENDING', count: '4' },
        { status: 'FAILED', count: '1' },
        { status: 'RUNNING', count: '2' },
        { status: 'SUCCEEDED', count: '10' },
        { status: 'DEAD_LETTERED', count: '1' },
      ],
    });

    const stats = await queue.stats();

    expect(stats).toEqual({ pending: 5, running: 2, succeeded: 10, deadLettered: 1 });
  });
});

describe('JobQueue.withTransaction', () => {
  it('hands the caller a client bound to the transaction', async () => {
    const queue = makeQueue();
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'job-1' }] }) };
    transactionMock.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn(client));

    const created = await queue.withTransaction((tx) =>
      queue.enqueue({ jobType: 'x', payload: {}, idempotencyKey: 'k', client: tx }),
    );

    // The decisive property: the job insert can share the transaction that performs
    // the state change, so both commit together or neither does.
    expect(created).toBe(true);
    expect(client.query).toHaveBeenCalledOnce();
  });
});

function row(): Record<string, unknown> {
  return {
    id: 'job-1',
    queue: 'default',
    job_type: 'deposit.record',
    payload: {},
    idempotency_key: 'k',
    status: 'RUNNING',
    attempt_count: 1,
    max_attempts: 5,
    run_at: new Date(),
    last_error: null,
  };
}
