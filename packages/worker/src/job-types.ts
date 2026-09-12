/**
 * Job type and queue name constants.
 *
 * Kept in one leaf module so producers, handlers and the readiness check can agree
 * on names without importing each other — which would otherwise create an import
 * cycle between the watcher, the tracker and the handler registry.
 */

/** Queue that carries work triggered by a chain observation. */
export const QUEUE_DEPOSITS = 'deposits';

/** Queue for outbound merchant webhook delivery. */
export const QUEUE_WEBHOOKS = 'webhooks';

/** Queue for settlement submission and retry. */
export const QUEUE_SETTLEMENT = 'settlements';

export const JOB_DEPOSIT_RECORD = 'deposit.record';
export const JOB_DEPOSIT_CONFIRM = 'deposit.confirm';
export const JOB_DEPOSIT_UNATTRIBUTED = 'deposit.unattributed';

export type JobType =
  typeof JOB_DEPOSIT_RECORD | typeof JOB_DEPOSIT_CONFIRM | typeof JOB_DEPOSIT_UNATTRIBUTED;
