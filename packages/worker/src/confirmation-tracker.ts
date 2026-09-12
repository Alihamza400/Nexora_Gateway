/**
 * Confirmation tracker.
 *
 * A deposit is only reversible until the chain reaches its confirmation depth. A
 * reorg that drops a payment the ledger already recorded produces a merchant who
 * was paid money that does not exist, so confirmation depth is a correctness
 * requirement rather than a UX nicety.
 *
 * This runs as a periodic sweep rather than a timer per payment: one query and one
 * status call per pending intent, no per-intent timers to lose on restart.
 */

import type { IChainClient } from '@crypto-gateway/shared';
import type { PaymentIntentRepository, PaymentIntentService } from '@crypto-gateway/payment-intent';
import { JOB_DEPOSIT_CONFIRM, QUEUE_DEPOSITS } from './job-types.js';
import type { JobQueue } from './job-queue.js';
import type { Logger } from './logger.js';

export interface ConfirmationTrackerDeps {
  chains: IChainClient[];
  repository: PaymentIntentRepository;
  intentService: PaymentIntentService;
  queue: JobQueue;
  logger: Logger;
  intervalMs: number;
  /** Max intents examined per sweep, so a backlog cannot stall the worker. */
  batchSize?: number;
}

export interface ConfirmationTrackerStats {
  sweeps: number;
  examined: number;
  confirmed: number;
  awaiting: number;
  lastSweepAt: string | null;
  lastError: string | null;
}

export class ConfirmationTracker {
  private readonly chainIndex = new Map<string, IChainClient>();
  private timer: NodeJS.Timeout | null = null;
  private counters = { sweeps: 0, examined: 0, confirmed: 0, awaiting: 0 };
  private lastSweepAt: Date | null = null;
  private lastError: string | null = null;

  constructor(private readonly deps: ConfirmationTrackerDeps) {
    for (const chain of deps.chains) this.chainIndex.set(chain.chainId, chain);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.deps.logger.error('confirmation sweep failed', { error: this.lastError });
      });
    }, this.deps.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Examine every DETECTED intent and enqueue a confirmation job for any that has
   * reached its chain's confirmation depth.
   *
   * @returns number of intents examined.
   */
  async runOnce(): Promise<number> {
    const batchSize = this.deps.batchSize ?? 100;
    const detected = await this.deps.repository.findByState('DETECTED', batchSize);
    this.counters.sweeps += 1;
    this.lastSweepAt = new Date();

    for (const intent of detected) {
      this.counters.examined += 1;

      const chainId = intent.deposit_chain;
      if (!chainId) {
        continue;
      }

      const client = this.chainIndex.get(chainId);
      if (!client) {
        // The chain is configured on the intent but not enabled on this worker.
        // Skipping is correct: another worker (or a later rollout) will handle it.
        continue;
      }

      const txHash = await this.findDepositTxHash(intent.id);
      if (!txHash) {
        this.deps.logger.warn('DETECTED intent has no deposit transaction hash', {
          intentId: intent.id,
        });
        continue;
      }

      let status;
      try {
        status = await client.getTransactionStatus(txHash);
      } catch (error: unknown) {
        // An RPC failure must not fail the whole sweep.
        this.lastError = error instanceof Error ? error.message : String(error);
        this.deps.logger.warn('transaction status lookup failed', {
          intentId: intent.id,
          chainId,
          txHash,
          error: this.lastError,
        });
        continue;
      }

      // A transaction that is gone is a reorg, not a failure: leave the intent in
      // DETECTED and let the recovery service treat it as a business state.
      if (status.status === 'FAILED') {
        this.deps.logger.warn('deposit transaction no longer present or failed', {
          intentId: intent.id,
          chainId,
          txHash,
          status: status.status,
        });
        continue;
      }

      const required = client.getConfirmationDepth();
      if (status.confirmations < required) {
        this.counters.awaiting += 1;
        continue;
      }

      // Enqueue rather than confirm inline: the transition is durable and retried,
      // and a crash between observing and recording cannot lose the confirmation.
      await this.deps.queue.enqueue({
        jobType: JOB_DEPOSIT_CONFIRM,
        queue: QUEUE_DEPOSITS,
        idempotencyKey: `confirm:${chainId}:${txHash}`,
        payload: {
          intentId: intent.id,
          txHash,
          confirmations: status.confirmations,
        },
      });
      this.counters.confirmed += 1;
    }

    return detected.length;
  }

  getStats(): ConfirmationTrackerStats {
    return {
      ...this.counters,
      lastSweepAt: this.lastSweepAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  /**
   * Read the deposit transaction hash from the intent's audit trail.
   *
   * The hash lives in the DEPOSIT_DETECTED event rather than on the intent row, so
   * this reads the append-only log — the same source of truth used for disputes.
   */
  private async findDepositTxHash(intentId: string): Promise<string | null> {
    const events = await this.deps.repository.getEvents(intentId);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.event_type !== 'DEPOSIT_DETECTED') continue;
      const hash = event.payload['tx_hash'];
      if (typeof hash === 'string' && hash.length > 0) return hash;
    }
    return null;
  }
}
