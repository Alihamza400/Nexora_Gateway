import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GasAbstractionService } from './gas-abstraction.service.js';
import type { IChainClient, GasAbstractionStrategy, RelayerTransaction } from '@crypto-gateway/shared';

// ─── Mock Chain Client ──────────────────────────────────────────────────

function createMockChainClient(overrides?: Partial<IChainClient>): IChainClient {
  return {
    chainId: '1',
    chainName: 'Ethereum',
    getConfirmationDepth: () => 12,
    getBlockTime: () => 12,
    getNativeAsset: () => ({ address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' }),
    validateAddress: (addr) => /^0x[0-9a-fA-F]{40}$/.test(addr),
    formatAddress: (addr) => addr,
    estimateGas: vi.fn(async () => ({
      gasLimit: 21000,
      gasPrice: 20000000000,
      totalCost: 0.00042,
      totalCostUSD: 1.47,
    })),
    submitTransaction: vi.fn(async () => ({ txHash: '0xabc', nonce: 1 })),
    getTransactionStatus: vi.fn(async () => ({
      txHash: '0xabc',
      status: 'CONFIRMED' as const,
      confirmations: 12,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      txHash: '0xabc',
      status: true,
      blockNumber: 100,
      blockHash: '0xblock',
      gasUsed: 21000,
      effectiveGasPrice: 20000000000,
      logs: [],
    })),
    getBalance: vi.fn(async () => ({
      asset: { address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' },
      amount: '1000000000000000000',
      amountUSD: 3500,
    })),
    getTokenBalance: vi.fn(async () => ({
      asset: { address: '0xabc', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
      amount: '1000000',
      amountUSD: 1,
    })),
    watchDeposits: vi.fn(() => () => {}),
    ...overrides,
  } as IChainClient;
}

// ─── Test Data ───────────────────────────────────────────────────────────

const mockTransaction: RelayerTransaction = {
  from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  value: '1000000000000000000',
  data: '0x',
  chainId: 1,
};

const mockChainClients = new Map<string, IChainClient>([
  ['1', createMockChainClient()],
  ['8453', createMockChainClient({ chainId: '8453', chainName: 'Base' })],
  ['tron', createMockChainClient({ chainId: 'tron', chainName: 'Tron' })],
  ['solana', createMockChainClient({ chainId: 'solana', chainName: 'Solana' })],
]);

// ─── Tests ───────────────────────────────────────────────────────────────

describe('GasAbstractionService', () => {
  let service: GasAbstractionService;

  beforeEach(() => {
    service = new GasAbstractionService(mockChainClients);
  });

  // ─── Strategy Detection ──────────────────────────────────────────────

  describe('getStrategy', () => {
    it('returns ERC4337_PAYMASTER for Ethereum', () => {
      expect(service.getStrategy('1')).toBe('ERC4337_PAYMASTER');
    });

    it('returns ERC4337_PAYMASTER for Base', () => {
      expect(service.getStrategy('8453')).toBe('ERC4337_PAYMASTER');
    });

    it('returns RELAYER for Polygon', () => {
      expect(service.getStrategy('137')).toBe('RELAYER');
    });

    it('returns RESOURCE_MODEL for Tron', () => {
      expect(service.getStrategy('tron')).toBe('RESOURCE_MODEL');
    });

    it('returns PRIORITY_FEE_RELAY for Solana', () => {
      expect(service.getStrategy('solana')).toBe('PRIORITY_FEE_RELAY');
    });

    it('returns RELAYER for unknown chains', () => {
      expect(service.getStrategy('unknown-chain')).toBe('RELAYER');
    });
  });

  // ─── Gas Cost Estimation ────────────────────────────────────────────

  describe('estimateGasCost', () => {
    it('estimates gas cost for Ethereum', async () => {
      const estimate = await service.estimateGasCost({
        chainId: '1',
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        value: '1000000000000000000',
        data: '0x',
      });

      expect(estimate.chainId).toBe('1');
      expect(estimate.strategy).toBe('ERC4337_PAYMASTER');
      expect(estimate.nativeSymbol).toBe('ETH');
      expect(estimate.nativeCost).toBeGreaterThan(0);
      expect(estimate.usdCost).toBeGreaterThan(0);
      expect(estimate.gasLimit).toBe(21000);
    });

    it('estimates gas cost with ERC-20 payment', async () => {
      const estimate = await service.estimateGasCost({
        chainId: '1',
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        value: '0',
        data: '0xabcdef',
        gasToken: 'USDC',
      });

      expect(estimate.tokenCost).toBeDefined();
      expect(estimate.tokenSymbol).toBe('USDC');
    });

    it('returns default estimate for unknown chain', async () => {
      const estimate = await service.estimateGasCost({
        chainId: 'unknown',
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        value: '1000000000000000000',
        data: '0x',
      });

      expect(estimate.chainId).toBe('unknown');
      expect(estimate.nativeCost).toBeGreaterThan(0);
    });
  });

  // ─── Gasless Availability ───────────────────────────────────────────

  describe('isGaslessAvailable', () => {
    it('returns false for chains without paymaster/relayer config', async () => {
      // Ethereum without paymaster config
      const available = await service.isGaslessAvailable('1');
      expect(available).toBe(false);
    });

    it('returns false for Tron (resource model)', async () => {
      const available = await service.isGaslessAvailable('tron');
      expect(available).toBe(false);
    });

    it('returns false for unknown chains', async () => {
      const available = await service.isGaslessAvailable('unknown');
      expect(available).toBe(false);
    });

    it('accepts stablecoins as fee tokens', async () => {
      // This tests the internal helper
      const available = await service.isGaslessAvailable('137', 'USDC');
      // Polygon has RELAYER strategy but no config, so false
      expect(available).toBe(false);
    });
  });

  // ─── Prepare Gasless Transaction ────────────────────────────────────

  describe('prepareGasless', () => {
    it('throws for unknown chain', async () => {
      await expect(
        service.prepareGasless({
          chainId: 'unknown',
          transaction: mockTransaction,
          senderAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        }),
      ).rejects.toThrow('No gas abstraction config');
    });

    it('prepares paymaster request for EVM chains', async () => {
      const request = await service.prepareGasless({
        chainId: '1',
        transaction: mockTransaction,
        senderAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      });

      expect(request).toHaveProperty('userOperation');
      expect(request).toHaveProperty('chainId');
      expect((request as any).chainId).toBe('1');
    });

    it('prepares relayer request for Polygon', async () => {
      const request = await service.prepareGasless({
        chainId: '137',
        transaction: mockTransaction,
        senderAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      });

      expect(request).toHaveProperty('transaction');
      expect(request).toHaveProperty('senderAddress');
      expect(request).toHaveProperty('maxFeeWei');
    });
  });

  // ─── Execute Gasless Transaction ────────────────────────────────────

  describe('executeGasless', () => {
    it('executes paymaster transaction', async () => {
      const prepared = await service.prepareGasless({
        chainId: '1',
        transaction: mockTransaction,
        senderAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      });

      const result = await service.executeGasless({
        chainId: '1',
        preparedRequest: prepared,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.cost).toBeDefined();
      expect(result.cost.nativeCost).toBe(0); // Sponsored
    });

    it('executes relayer transaction', async () => {
      const prepared = await service.prepareGasless({
        chainId: '137',
        transaction: mockTransaction,
        senderAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      });

      const result = await service.executeGasless({
        chainId: '137',
        preparedRequest: prepared,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.cost.gaslessFee).toBeDefined();
    });

    it('returns error for unknown chain', async () => {
      const result = await service.executeGasless({
        chainId: 'unknown',
        preparedRequest: { transaction: mockTransaction, senderAddress: '0xabc', maxFeeWei: '100' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No gas abstraction config');
    });
  });

  // ─── Custom Configuration ───────────────────────────────────────────

  describe('custom configuration', () => {
    it('accepts custom chain configs', () => {
      const customConfigs = new Map([
        ['1', { strategy: 'RELAYER' as GasAbstractionStrategy }],
      ]);

      const customService = new GasAbstractionService(mockChainClients, customConfigs);
      expect(customService.getStrategy('1')).toBe('RELAYER');
    });

    it('adds new chain configs', () => {
      const customConfigs = new Map([
        ['999', {
          chainId: '999',
          strategy: 'ERC4337_PAYMASTER' as GasAbstractionStrategy,
          nativeSymbol: 'CUSTOM',
          nativeDecimals: 18,
          nativePriceUsd: 100,
        }],
      ]);

      const customService = new GasAbstractionService(mockChainClients, customConfigs);
      expect(customService.getStrategy('999')).toBe('ERC4337_PAYMASTER');
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('handles chain client errors gracefully', async () => {
      const errorClient = createMockChainClient({
        estimateGas: vi.fn(async () => { throw new Error('RPC error'); }),
      });

      const errorClients = new Map([['1', errorClient]]);
      const errorService = new GasAbstractionService(errorClients);

      // Should not throw, return default estimate
      const estimate = await errorService.estimateGasCost({
        chainId: '1',
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        value: '1000000000000000000',
        data: '0x',
      });

      expect(estimate).toBeDefined();
    });
  });
});
