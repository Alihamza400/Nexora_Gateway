/**
 * Job handlers.
 *
 * Every handler here must be idempotent. The queue delivers at-least-once: a job
 * whose worker died mid-execution is reclaimed and run again, so a handler that
 * cannot tolerate a second invocation will eventually double-apply something.
 *
 * Handlers are deliberately thin. All state rules live in PaymentIntentService, so
 * the worker cannot drift from the state machine the gateway also uses.
 */

import type { PaymentIntentService } from '@crypto-gateway/payment-intent';
import { JOB_DEPOSIT_CONFIRM, JOB_DEPOSIT_RECORD, JOB_DEPOSIT_UNATTRIBUTED } from './job-types.js';
import type { JobQueue, JobRecord } from './job-queue.js';
import type { Logger } from './logger.js';

export interface JobHandlerDeps {
  intentService: PaymentIntentService;
  logger: Logger;
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Job payload missing required string field "${key}"`);
  }
  return value;
}

function requireNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Job payload missing required numeric field "${key}"`);
  }
  return value;
}

/**
 * Record an observed deposit against an intent.
 *
 * Idempotent: PaymentIntentService.recordDeposit returns the current intent
 * unchanged when the intent no longer accepts a deposit, so a replayed job is a
 * no-op rather than a second transition.
 */
export async function handleDepositRecord(job: JobRecord, deps: JobHandlerDeps): Promise<void> {
  const intentId = requireString(job.payload, 'intentId');
  const txHash = requireString(job.payload, 'txHash');
  const sourceChain = requireString(job.payload, 'sourceChain');
  const sourceAsset = requireString(job.payload, 'sourceAsset');
  const amount = requireNumber(job.payload, 'amount');

  const intent = await deps.intentService.recordDeposit(
    intentId,
    txHash,
    amount,
    sourceChain,
    sourceAsset,
  );

  deps.logger.info('deposit recorded', {
    intentId,
    txHash,
    state: intent.state,
  });
}

/**
 * Confirm a deposit once its chain has reached the required depth.
 *
 * Idempotent via the queue's idempotency key (`confirm:<chain>:<txHash>`): a second
 * enqueue of the same confirmation is discarded by the database before it can run.
 */
export async function handleDepositConfirm(job: JobRecord, deps: JobHandlerDeps): Promise<void> {
  const intentId = requireString(job.payload, 'intentId');
  const confirmations = requireNumber(job.payload, 'confirmations');

  const intent = await deps.intentService.confirmDeposit(intentId, confirmations);

  deps.logger.info('deposit confirmed', {
    intentId,
    confirmations,
    state: intent.state,
  });
}

/**
 * A deposit arrived at an address no intent is expecting.
 *
 * The job row is the audit record: it is retained, queryable and alertable. The
 * handler only logs, because there is no automated remedy — a human decides
 * whether this is a mis-sent payment to refund or a stale address to investigate.
 */
export function handleDepositUnattributed(job: JobRecord, deps: JobHandlerDeps): Promise<void> {
  deps.logger.warn('unattributed deposit requires investigation', {
    chainId: job.payload['chainId'],
    address: job.payload['address'],
    txHash: job.payload['txHash'],
    amount: job.payload['amount'],
    asset: job.payload['asset'],
  });
  // Nothing to await: there is no automated remedy, so the handler completes and
  // the retained job row is the record that a human needs to look at this.
  return Promise.resolve();
}

/** Wire every handler into the queue. */
export function registerJobHandlers(queue: JobQueue, deps: JobHandlerDeps): void {
  queue.registerHandler(JOB_DEPOSIT_RECORD, (job) => handleDepositRecord(job, deps));
  queue.registerHandler(JOB_DEPOSIT_CONFIRM, (job) => handleDepositConfirm(job, deps));
  queue.registerHandler(JOB_DEPOSIT_UNATTRIBUTED, (job) => handleDepositUnattributed(job, deps));
}
