/*
 * Test doubles implement an async chain-client interface without awaiting, and
 * assertions reference jest-style mock methods directly. Both are correct in tests.
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IChainClient, PaymentIntent, IntentEvent } from '@crypto-gateway/shared';
import { ConfirmationTracker } from './confirmation-tracker.js';
import { JOB_DEPOSIT_CONFIRM, QUEUE_DEPOSITS } from './job-types.js';
import type { Logger } from './logger.js';

function makeChain(chainId: string, opts: { depth?: number; throws?: boolean } = {}): IChainClient {
  const depth = opts.depth ?? 3;
  return {
    chainId,
    chainName: chainId,
    getConfirmationDepth: () => depth,
    getBlockTime: () => 2,
    getNativeAsset: () => ({ address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' }),
    validateAddress: () => true,
    formatAddress: (address: string) => address,
    estimateGas: async () => ({ gasLimit: 21000, gasPrice: 1, totalCost: 21000, totalCostUSD: 0 }),
    submitTransaction: async () => ({ txHash: '0x0', status: 'PENDING' as const }),
    getTransactionStatus: async (txHash: string) => {
      if (opts.throws) throw new Error('rpc unavailable');
      return { txHash, status: 'CONFIRMED' as const, confirmations: depth, blockNumber: 10 };
    },
    getTransactionReceipt: async (txHash: string) => ({
      txHash,
      status: true,
      blockNumber: 10,
      blockHash: '0xb',
      gasUsed: 21000,
      effectiveGasPrice: 1,
      logs: [],
    }),
    getBalance: async () => ({
      asset: { address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' },
      amount: '0',
      amountUSD: 0,
    }),
    getTokenBalance: async () => ({
      asset: { address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' },
      amount: '0',
      amountUSD: 0,
    }),
    watchDeposits: () => () => undefined,
  };
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
    quote_expires_at: null,
    deposit_address: '0xDeposit',
    deposit_asset: 'USDC',
    deposit_chain: 'base-sepolia',
    state: 'DETECTED',
    version: 2,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeEvent(txHash: string | null): IntentEvent {
  return {
    id: 'event-1',
    intent_id: 'intent-1',
    event_type: 'DEPOSIT_DETECTED',
    payload: txHash ? { tx_hash: txHash } : { amount: 1 },
    version: 2,
    created_at: new Date(),
  };
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('ConfirmationTracker', () => {
  let repository: { findByState: ReturnType<typeof vi.fn>; getEvents: ReturnType<typeof vi.fn> };
  let queue: { enqueue: ReturnType<typeof vi.fn> };
  let logger: Logger;
  let intentService: { confirmDeposit: ReturnType<typeof vi.fn> };

  function makeTracker(chains: IChainClient[], intervalMs = 15_000): ConfirmationTracker {
    return new ConfirmationTracker({
      chains,
      repository: repository as never,
      intentService: intentService as never,
      queue: queue as never,
      logger,
      intervalMs,
    });
  }

  beforeEach(() => {
    repository = {
      findByState: vi.fn().mockResolvedValue([makeIntent()]),
      getEvents: vi.fn().mockResolvedValue([makeEvent('0xdeadbeef')]),
    };
    queue = { enqueue: vi.fn().mockResolvedValue(true) };
    logger = makeLogger();
    intentService = { confirmDeposit: vi.fn() };
  });

  it('only examines intents in the DETECTED state', async () => {
    await makeTracker([makeChain('base-sepolia')]).runOnce();

    expect(repository.findByState).toHaveBeenCalledWith('DETECTED', 100);
  });

  it('enqueues a confirmation once the deposit reaches the required depth', async () => {
    const tracker = makeTracker([makeChain('base-sepolia', { depth: 3 })]);

    const examined = await tracker.runOnce();

    expect(examined).toBe(1);
    const call = queue.enqueue.mock.calls[0]?.[0] as {
      jobType: string;
      queue: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    };
    expect(call.jobType).toBe(JOB_DEPOSIT_CONFIRM);
    expect(call.queue).toBe(QUEUE_DEPOSITS);
    // Keyed on chain+tx, so a second sweep for the same deposit is discarded by the
    // database rather than confirming twice.
    expect(call.idempotencyKey).toBe('confirm:base-sepolia:0xdeadbeef');
    expect(call.payload['confirmations']).toBe(3);
    expect(tracker.getStats().confirmed).toBe(1);
  });

  it('waits while confirmations are still below the required depth', async () => {
    // Chain reports 1 confirmation; the tracker requires 3.
    const chain = makeChain('base-sepolia', { depth: 3 });
    chain.getTransactionStatus = async (txHash: string) => ({
      txHash,
      status: 'PENDING' as const,
      confirmations: 1,
    });
    const tracker = makeTracker([chain]);

    await tracker.runOnce();

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(tracker.getStats().awaiting).toBe(1);
  });

  it('skips an intent whose audit trail has no transaction hash', async () => {
    repository.getEvents.mockResolvedValue([makeEvent(null)]);
    const tracker = makeTracker([makeChain('base-sepolia')]);

    await tracker.runOnce();

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'DETECTED intent has no deposit transaction hash',
      expect.any(Object),
    );
  });

  it('skips a chain this worker does not have enabled', async () => {
    const tracker = makeTracker([makeChain('ethereum-sepolia')]);

    await tracker.runOnce();

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('continues the sweep when one RPC lookup fails', async () => {
    repository.findByState.mockResolvedValue([
      makeIntent({ id: 'intent-1' }),
      makeIntent({ id: 'intent-2' }),
    ]);
    const chain = makeChain('base-sepolia');
    let call = 0;
    chain.getTransactionStatus = async (txHash: string) => {
      call += 1;
      if (call === 1) throw new Error('rpc unavailable');
      return { txHash, status: 'CONFIRMED' as const, confirmations: 3 };
    };
    const tracker = makeTracker([chain]);

    const examined = await tracker.runOnce();

    expect(examined).toBe(2);
    // The failure is isolated; the healthy intent is still confirmed.
    expect(queue.enqueue).toHaveBeenCalledOnce();
    expect(tracker.getStats().lastError).toBe('rpc unavailable');
  });

  it('leaves a reorged transaction in DETECTED for the recovery service', async () => {
    const chain = makeChain('base-sepolia');
    chain.getTransactionStatus = async (txHash: string) => ({
      txHash,
      status: 'FAILED' as const,
      confirmations: 0,
    });
    const tracker = makeTracker([chain]);

    await tracker.runOnce();

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'deposit transaction no longer present or failed',
      expect.any(Object),
    );
  });

  it('reports the most recent sweep time and terminal sweep failures', async () => {
    repository.findByState.mockRejectedValue(new Error('db down'));
    const tracker = makeTracker([makeChain('base-sepolia')]);

    await expect(tracker.runOnce()).rejects.toThrow('db down');
    expect(tracker.getStats().sweeps).toBe(0);
  });

  it('finds the transaction hash from the most recent deposit event', async () => {
    repository.getEvents.mockResolvedValue([
      makeEvent('0xold'),
      { ...makeEvent('0xnew'), id: 'event-2' },
    ]);
    const tracker = makeTracker([makeChain('base-sepolia')]);

    await tracker.runOnce();

    const call = queue.enqueue.mock.calls[0]?.[0] as { idempotencyKey: string };
    expect(call.idempotencyKey).toContain('0xnew');
  });

  it('stops the interval timer without throwing', () => {
    const tracker = makeTracker([makeChain('base-sepolia')]);
    tracker.start();
    tracker.stop();
    tracker.stop();
    expect(tracker.getStats().sweeps).toBe(0);
  });
});
