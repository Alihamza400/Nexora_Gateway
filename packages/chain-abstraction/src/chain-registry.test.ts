/**
 * ChainRegistry Unit Tests
 * Tests registration, lookup, enumeration, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChainRegistry } from './chain-registry.js';
import type { IChainClient } from '@crypto-gateway/shared';
import { UnsupportedChainError } from '@crypto-gateway/shared';

// ─── Mock Chain Client Factory ──────────────────────────────────────────────

function createMockClient(chainId: string, chainName: string): IChainClient {
  return {
    chainId,
    chainName,
    getConfirmationDepth: () => 12,
    getBlockTime: () => 12,
    getNativeAsset: () => ({ address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' }),
    validateAddress: () => true,
    formatAddress: (addr) => addr,
    estimateGas: async () => ({ gasLimit: 21000, gasPrice: 20, totalCost: 420000, totalCostUSD: 0 }),
    submitTransaction: async () => ({ txHash: '0xabc' }),
    getTransactionStatus: async () => ({ txHash: '0xabc', status: 'CONFIRMED', confirmations: 12 }),
    getTransactionReceipt: async () => ({
      txHash: '0xabc', status: true, blockNumber: 100, blockHash: '0xdef',
      gasUsed: 21000, effectiveGasPrice: 20, logs: [],
    }),
    getBalance: async () => ({ asset: { address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' }, amount: '0', amountUSD: 0 }),
    getTokenBalance: async () => ({ asset: { address: '0xtoken', symbol: 'USDC', decimals: 6, name: 'USD Coin' }, amount: '0', amountUSD: 0 }),
    watchDeposits: () => () => {},
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ChainRegistry', () => {
  let registry: ChainRegistry;

  beforeEach(() => {
    registry = new ChainRegistry();
  });

  // ─── Registration ───────────────────────────────────────────────────────

  describe('register', () => {
    it('registers a chain client', () => {
      const client = createMockClient('1', 'Ethereum');
      registry.register(client);
      expect(registry.size()).toBe(1);
    });

    it('throws on duplicate chainId', () => {
      const client1 = createMockClient('1', 'Ethereum');
      const client2 = createMockClient('1', 'Ethereum');
      registry.register(client1);
      expect(() => registry.register(client2)).toThrow('already registered');
    });
  });

  // ─── Lookup ─────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns client by chainId', () => {
      const client = createMockClient('1', 'Ethereum');
      registry.register(client);
      expect(registry.get('1')).toBe(client);
    });

    it('throws UnsupportedChainError for unknown chainId', () => {
      expect(() => registry.get('999')).toThrow(UnsupportedChainError);
    });
  });

  describe('getByName', () => {
    it('returns client by name (case-insensitive)', () => {
      const client = createMockClient('1', 'Ethereum');
      registry.register(client);
      expect(registry.getByName('ethereum')).toBe(client);
      expect(registry.getByName('ETHEREUM')).toBe(client);
    });

    it('returns undefined for unknown name', () => {
      expect(registry.getByName('unknown')).toBeUndefined();
    });
  });

  describe('tryGet', () => {
    it('returns client for known chainId', () => {
      const client = createMockClient('1', 'Ethereum');
      registry.register(client);
      expect(registry.tryGet('1')).toBe(client);
    });

    it('returns undefined for unknown chainId', () => {
      expect(registry.tryGet('999')).toBeUndefined();
    });
  });

  // ─── Enumeration ────────────────────────────────────────────────────────

  describe('enumeration', () => {
    it('returns all registered clients', () => {
      const eth = createMockClient('1', 'Ethereum');
      const base = createMockClient('8453', 'Base');
      registry.register(eth);
      registry.register(base);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(eth);
      expect(all).toContain(base);
    });

    it('returns supported chain IDs', () => {
      registry.register(createMockClient('1', 'Ethereum'));
      registry.register(createMockClient('8453', 'Base'));

      const ids = registry.getSupportedChainIds();
      expect(ids).toContain('1');
      expect(ids).toContain('8453');
    });

    it('returns supported chain names', () => {
      registry.register(createMockClient('1', 'Ethereum'));
      registry.register(createMockClient('8453', 'Base'));

      const names = registry.getSupportedChainNames();
      expect(names).toContain('ethereum');
      expect(names).toContain('base');
    });
  });

  // ─── Unregister ─────────────────────────────────────────────────────────

  describe('unregister', () => {
    it('removes a registered chain', () => {
      registry.register(createMockClient('1', 'Ethereum'));
      expect(registry.size()).toBe(1);

      const removed = registry.unregister('1');
      expect(removed).toBe(true);
      expect(registry.size()).toBe(0);
    });

    it('returns false for unknown chain', () => {
      expect(registry.unregister('999')).toBe(false);
    });

    it('removes name index entry', () => {
      registry.register(createMockClient('1', 'Ethereum'));
      registry.unregister('1');
      expect(registry.getByName('ethereum')).toBeUndefined();
    });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  describe('isSupported', () => {
    it('returns true for registered chain', () => {
      registry.register(createMockClient('1', 'Ethereum'));
      expect(registry.isSupported('1')).toBe(true);
    });

    it('returns false for unregistered chain', () => {
      expect(registry.isSupported('999')).toBe(false);
    });
  });

  describe('size', () => {
    it('returns 0 for empty registry', () => {
      expect(registry.size()).toBe(0);
    });

    it('returns correct count', () => {
      registry.register(createMockClient('1', 'Ethereum'));
      registry.register(createMockClient('8453', 'Base'));
      registry.register(createMockClient('42161', 'Arbitrum'));
      expect(registry.size()).toBe(3);
    });
  });
});
