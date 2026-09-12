/**
 * Deposit watcher.
 *
 * Subscribes to every address the gateway is currently expecting a payment at and
 * converts an observed transfer into a durable job.
 *
 * The callback does one thing: enqueue. It does not touch the state machine. That
 * split matters because the chain client's callback is synchronous and
 * fire-and-forget — doing the state transition inside it would mean an in-flight
 * transition is lost whenever the process exits. Enqueuing is a single insert with
 * a unique idempotency key, so the delivery is durable and re-delivery is free.
 */

import type {
  DepositEvent,
  IChainClient,
  Unsubscribe,
  PaymentIntent,
} from '@crypto-gateway/shared';
import type { PaymentIntentRepository } from '@crypto-gateway/payment-intent';
import { JOB_DEPOSIT_RECORD, JOB_DEPOSIT_UNATTRIBUTED, QUEUE_DEPOSITS } from './job-types.js';
import type { JobQueue } from './job-queue.js';
import type { Logger } from './logger.js';

export interface DepositWatcherDeps {
  chains: IChainClient[];
  repository: PaymentIntentRepository;
  queue: JobQueue;
  logger: Logger;
  refreshIntervalMs: number;
}

export interface DepositWatcherStats {
  watchedAddresses: number;
  chains: number;
  received: number;
  attributed: number;
  unattributed: number;
  lastEventAt: string | null;
}

/**
 * Stable identity for one observed transfer.
 *
 * Deliberately includes every field that distinguishes one transfer from another,
 * because `DepositEvent` carries no log index: a single transaction can contain
 * several transfers to the same address, and without the amount in the key those
 * would collapse into one. Adding `logIndex` to `DepositEvent` is the durable fix
 * and is tracked in WS1.3.
 */
export function depositIdempotencyKey(chainId: string, event: DepositEvent): string {
  return [
    'deposit',
    chainId,
    event.txHash.toLowerCase(),
    event.to.toLowerCase(),
    event.asset.address.toLowerCase(),
    event.amount,
  ].join(':');
}

/**
 * Convert a base-unit amount string to a decimal amount.
 *
 * CAUTION: uses Number, which is exact only up to 2^53. Sufficient for typical
 * payment sizes and for the current state machine, which compares amounts as
 * numbers. Moving to a decimal-safe representation is required before mainnet and
 * is tracked in WS5.
 */
export function normalizeAmount(amount: string, decimals: number): number {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed / 10 ** decimals;
}

export class DepositWatcher {
  private readonly subscriptions = new Map<string, Map<string, Unsubscribe>>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private started = false;
  private counters = { received: 0, attributed: 0, unattributed: 0 };
  private lastEventAt: Date | null = null;

  constructor(private readonly deps: DepositWatcherDeps) {}

  /**
   * Subscribe to everything currently awaiting a deposit, then keep the
   * subscription set in step with the database.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.refresh();

    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        // A failed refresh must not kill the timer; the next tick retries.
        this.deps.logger.error('deposit watcher refresh failed', { error: describe(error) });
      });
    }, this.deps.refreshIntervalMs);
    // Do not hold the event loop open purely for the refresh timer.
    this.refreshTimer.unref?.();
  }

  /**
   * Reconcile subscriptions against the intents currently expecting a deposit.
   *
   * Incremental on purpose: existing subscriptions are left alone so a customer
   * mid-payment is never momentarily unwatched.
   */
  async refresh(): Promise<void> {
    const awaiting = await this.deps.repository.findAwaitingDeposits();
    const byChain = new Map<string, Set<string>>();

    for (const intent of awaiting) {
      if (!intent.deposit_address || !intent.deposit_chain) continue;
      const chainId = intent.deposit_chain;
      if (!byChain.has(chainId)) byChain.set(chainId, new Set());
      byChain.get(chainId)?.add(intent.deposit_address);
    }

    for (const client of this.deps.chains) {
      const wanted = byChain.get(client.chainId) ?? new Set<string>();
      const current = this.subscriptions.get(client.chainId) ?? new Map<string, Unsubscribe>();

      // Add newly wanted addresses.
      for (const address of wanted) {
        if (current.has(address)) continue;
        const unsubscribe = client.watchDeposits(address, (event) => {
          void this.onDeposit(client.chainId, event).catch((error: unknown) => {
            this.deps.logger.error('failed to enqueue deposit', {
              chainId: client.chainId,
              txHash: event.txHash,
              error: describe(error),
            });
          });
        });
        current.set(address, unsubscribe);
      }

      // Drop addresses no longer awaiting a deposit (settled, expired, refunded).
      for (const [address, unsubscribe] of current) {
        if (wanted.has(address)) continue;
        this.safeUnsubscribe(unsubscribe, client.chainId, address);
        current.delete(address);
      }

      this.subscriptions.set(client.chainId, current);
    }
  }

  /**
   * Tear down every subscription.
   *
   * Synchronous because `Unsubscribe` is synchronous: an async signature here would
   * imply the caller must wait for something that never happens.
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    for (const [chainId, addresses] of this.subscriptions) {
      for (const [address, unsubscribe] of addresses) {
        this.safeUnsubscribe(unsubscribe, chainId, address);
      }
      addresses.clear();
    }
    this.subscriptions.clear();
    this.started = false;
  }

  getStats(): DepositWatcherStats {
    let watched = 0;
    for (const addresses of this.subscriptions.values()) watched += addresses.size;

    return {
      watchedAddresses: watched,
      chains: this.subscriptions.size,
      received: this.counters.received,
      attributed: this.counters.attributed,
      unattributed: this.counters.unattributed,
      lastEventAt: this.lastEventAt?.toISOString() ?? null,
    };
  }

  /** Resolve the observed transfer to an intent and enqueue the durable job. */
  private async onDeposit(chainId: string, event: DepositEvent): Promise<void> {
    this.counters.received += 1;
    this.lastEventAt = new Date();

    const key = depositIdempotencyKey(chainId, event);
    const intent = await this.deps.repository.findAwaitingDepositAt(chainId, event.to);

    if (!intent) {
      // Funds arrived at an address nobody is expecting. Record it so it is
      // investigable; never drop it on the floor.
      this.counters.unattributed += 1;
      this.deps.logger.warn('deposit at an address no intent is awaiting', {
        chainId,
        address: event.to,
        txHash: event.txHash,
      });
      await this.deps.queue.enqueue({
        jobType: JOB_DEPOSIT_UNATTRIBUTED,
        queue: QUEUE_DEPOSITS,
        idempotencyKey: `${key}:unattributed`,
        payload: {
          chainId,
          address: event.to,
          txHash: event.txHash,
          amount: event.amount,
          asset: event.asset.symbol,
          blockNumber: event.blockNumber,
        },
      });
      return;
    }

    this.counters.attributed += 1;
    await this.deps.queue.enqueue({
      jobType: JOB_DEPOSIT_RECORD,
      queue: QUEUE_DEPOSITS,
      idempotencyKey: key,
      payload: {
        intentId: intent.id,
        txHash: event.txHash,
        amount: normalizeAmount(event.amount, event.asset.decimals),
        sourceChain: chainId,
        sourceAsset: event.asset.symbol,
        blockNumber: event.blockNumber,
      },
    });
  }

  /** Unsubscribing must never take the worker down. */
  private safeUnsubscribe(unsubscribe: Unsubscribe, chainId: string, address: string): void {
    try {
      unsubscribe();
    } catch (error: unknown) {
      this.deps.logger.warn('unsubscribe failed', { chainId, address, error: describe(error) });
    }
  }

  /** Exposed for the confirmation tracker: the intent a transfer belongs to. */
  async resolveIntent(chainId: string, address: string): Promise<PaymentIntent | null> {
    return this.deps.repository.findAwaitingDepositAt(chainId, address);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
