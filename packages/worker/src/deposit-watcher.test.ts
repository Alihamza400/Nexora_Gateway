/*
 * Test doubles implement an async chain-client interface, and assertions reference
 * jest-style mock methods directly. Both are correct in tests and are noise here.
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DepositEvent, IChainClient, PaymentIntent } from '@crypto-gateway/shared';
import { DepositWatcher, depositIdempotencyKey, normalizeAmount } from './deposit-watcher.js';
import { JOB_DEPOSIT_RECORD, JOB_DEPOSIT_UNATTRIBUTED, QUEUE_DEPOSITS } from './job-types.js';
import type { Logger } from './logger.js';

const USDC = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
};

interface FakeChain extends IChainClient {
  emit(address: string, event: Partial<DepositEvent>): void;
  watched: Set<string>;
  unsubscribeCount: number;
}

function makeChain(chainId: string, depth = 1): FakeChain {
  const callbacks = new Map<string, (event: DepositEvent) => void>();
  const chain: FakeChain = {
    chainId,
    chainName: chainId,
    getConfirmationDepth: () => depth,
    getBlockTime: () => 2,
    getNativeAsset: () => ({ address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' }),
    validateAddress: () => true,
    formatAddress: (address: string) => address,
    estimateGas: async () => ({ gasLimit: 21000, gasPrice: 1, totalCost: 21000, totalCostUSD: 0 }),
    submitTransaction: async () => ({ txHash: '0x0', status: 'PENDING' as const }),
    getTransactionStatus: async (txHash: string) => ({
      txHash,
      status: 'CONFIRMED' as const,
      confirmations: depth,
    }),
    getTransactionReceipt: async (txHash: string) => ({
      txHash,
      status: true,
      blockNumber: 1,
      blockHash: '0xblock',
      gasUsed: 21000,
      effectiveGasPrice: 1,
      logs: [],
    }),
    getBalance: async () => ({ asset: USDC, amount: '0', amountUSD: 0 }),
    getTokenBalance: async () => ({ asset: USDC, amount: '0', amountUSD: 0 }),
    watchDeposits: (address, onDeposit) => {
      callbacks.set(address, onDeposit);
      chain.watched.add(address);
      return () => {
        callbacks.delete(address);
        chain.watched.delete(address);
        chain.unsubscribeCount += 1;
      };
    },
    emit: (address, event) => {
      const callback = callbacks.get(address);
      if (callback) {
        callback({
          txHash: '0xdeadbeef',
          blockNumber: 100,
          from: '0xsender',
          to: address,
          asset: USDC,
          amount: '1000000',
          confirmations: 0,
          ...event,
        });
      }
    },
    watched: new Set<string>(),
    unsubscribeCount: 0,
  };
  return chain;
}

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: 'intent-1',
    merchant_id: 'merchant-1',
    order_ref: 'order-1',
    target_amount: 1,
    target_asset: 'USDC',
    target_chain: '1',
    accepted_assets: ['USDC'],
    quoted_rate: 1,
    quote_expires_at: new Date(Date.now() + 300000),
    deposit_address: '0xDeposit',
    deposit_asset: 'USDC',
    deposit_chain: 'base-sepolia',
    state: 'AWAITING_PAYMENT',
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('depositIdempotencyKey', () => {
  const event: DepositEvent = {
    txHash: '0xABC',
    blockNumber: 1,
    from: '0x1',
    to: '0xDeposit',
    asset: USDC,
    amount: '1000',
    confirmations: 0,
  };

  it('is stable for the same transfer and normalises case', () => {
    expect(depositIdempotencyKey('1', event)).toBe(depositIdempotencyKey('1', { ...event }));
  });

  it('distinguishes transfers that differ only by amount', () => {
    // DepositEvent carries no log index, so two transfers in one transaction would
    // otherwise collapse into a single key and one would be silently dropped.
    expect(depositIdempotencyKey('1', event)).not.toBe(
      depositIdempotencyKey('1', { ...event, amount: '2000' }),
    );
  });

  it('distinguishes the same transfer observed on a different chain', () => {
    expect(depositIdempotencyKey('1', event)).not.toBe(depositIdempotencyKey('84532', event));
  });
});

describe('normalizeAmount', () => {
  it('scales base units by the asset decimals', () => {
    expect(normalizeAmount('1000000', 6)).toBe(1);
    expect(normalizeAmount('1500000000000000000', 18)).toBe(1.5);
  });

  it('returns NaN for an unparseable amount rather than silently returning zero', () => {
    expect(normalizeAmount('not-a-number', 6)).toBeNaN();
  });
});

describe('DepositWatcher', () => {
  let chain: FakeChain;
  let repository: {
    findAwaitingDeposits: ReturnType<typeof vi.fn>;
    findAwaitingDepositAt: ReturnType<typeof vi.fn>;
  };
  let queue: { enqueue: ReturnType<typeof vi.fn> };
  let logger: Logger;

  beforeEach(() => {
    chain = makeChain('base-sepolia');
    repository = {
      findAwaitingDeposits: vi.fn().mockResolvedValue([makeIntent()]),
      findAwaitingDepositAt: vi.fn().mockResolvedValue(makeIntent()),
    };
    queue = { enqueue: vi.fn().mockResolvedValue(true) };
    logger = makeLogger();
  });

  function makeWatcher(): DepositWatcher {
    return new DepositWatcher({
      chains: [chain],
      repository: repository as never,
      queue: queue as never,
      logger,
      refreshIntervalMs: 60_000,
    });
  }

  it('subscribes to every address currently awaiting a deposit', async () => {
    const watcher = makeWatcher();

    await watcher.refresh();

    expect(chain.watched.has('0xDeposit')).toBe(true);
    expect(watcher.getStats().watchedAddresses).toBe(1);
    watcher.stop();
  });

  it('ignores intents with no deposit address or chain', async () => {
    repository.findAwaitingDeposits.mockResolvedValue([
      makeIntent({ deposit_address: null }),
      makeIntent({ deposit_chain: null }),
    ]);
    const watcher = makeWatcher();

    await watcher.refresh();

    expect(watcher.getStats().watchedAddresses).toBe(0);
    watcher.stop();
  });

  it('enqueues a durable job instead of transitioning state inline', async () => {
    const watcher = makeWatcher();
    await watcher.refresh();

    chain.emit('0xDeposit', {});
    // The enqueue is fire-and-forget from a synchronous chain callback.
    await new Promise((resolve) => setImmediate(resolve));

    expect(queue.enqueue).toHaveBeenCalledOnce();
    const call = queue.enqueue.mock.calls[0]?.[0] as {
      jobType: string;
      queue: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    };
    expect(call.jobType).toBe(JOB_DEPOSIT_RECORD);
    expect(call.queue).toBe(QUEUE_DEPOSITS);
    expect(call.payload['intentId']).toBe('intent-1');
    // 1_000_000 base units of a 6-decimal asset is 1.0.
    expect(call.payload['amount']).toBe(1);
    expect(call.idempotencyKey).toContain('0xdeadbeef');
    watcher.stop();
  });

  it('records a deposit at an address no intent expects, rather than dropping it', async () => {
    repository.findAwaitingDepositAt.mockResolvedValue(null);
    const watcher = makeWatcher();
    await watcher.refresh();

    chain.emit('0xDeposit', {});
    await new Promise((resolve) => setImmediate(resolve));

    const call = queue.enqueue.mock.calls[0]?.[0] as { jobType: string; idempotencyKey: string };
    expect(call.jobType).toBe(JOB_DEPOSIT_UNATTRIBUTED);
    expect(call.idempotencyKey).toContain('unattributed');
    expect(watcher.getStats().unattributed).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
    watcher.stop();
  });

  it('does not re-subscribe on a refresh when nothing changed', async () => {
    const watcher = makeWatcher();
    await watcher.refresh();
    const firstUnsubscribes = chain.unsubscribeCount;

    await watcher.refresh();

    // Incremental reconcile: a customer mid-payment is never momentarily unwatched.
    expect(chain.unsubscribeCount).toBe(firstUnsubscribes);
    expect(chain.watched.size).toBe(1);
    watcher.stop();
  });

  it('unsubscribes once an intent no longer awaits a deposit', async () => {
    const watcher = makeWatcher();
    await watcher.refresh();

    repository.findAwaitingDeposits.mockResolvedValue([]);
    await watcher.refresh();

    expect(chain.unsubscribeCount).toBe(1);
    expect(chain.watched.size).toBe(0);
    watcher.stop();
  });

  it('stops every subscription on shutdown', async () => {
    const watcher = makeWatcher();
    await watcher.start();
    watcher.stop();

    expect(chain.watched.size).toBe(0);
  });

  it('tolerates an unsubscribe that throws', async () => {
    // A subscription whose teardown fails must not take the watcher down: the next
    // refresh will try again, and the alternative is losing every other chain.
    chain.watchDeposits = (address: string, onDeposit: (event: DepositEvent) => void) => {
      void address;
      void onDeposit;
      return () => {
        throw new Error('rpc gone');
      };
    };
    const watcher = makeWatcher();
    await watcher.refresh();

    repository.findAwaitingDeposits.mockResolvedValue([]);
    await expect(watcher.refresh()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('unsubscribe failed', expect.any(Object));
    watcher.stop();
  });

  it('is safe to start twice', async () => {
    const watcher = makeWatcher();
    await watcher.start();
    await watcher.start();
    expect(chain.watched.size).toBe(1);
    watcher.stop();
  });
});
