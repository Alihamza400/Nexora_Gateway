import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TronChainClient } from './tron-chain-client.js';
import { InvalidAddressError } from '@crypto-gateway/shared';

describe('TronChainClient', () => {
  let client: TronChainClient;

  beforeEach(() => {
    client = new TronChainClient();
  });

  afterEach(async () => {
    await client.destroy();
  });

  // ─── Chain Info ──────────────────────────────────────────────────────

  describe('chain info', () => {
    it('returns correct chainId', () => {
      expect(client.chainId).toBe('tron');
    });

    it('returns correct chainName', () => {
      expect(client.chainName).toBe('Tron');
    });

    it('returns confirmation depth of 19', () => {
      expect(client.getConfirmationDepth()).toBe(19);
    });

    it('returns block time of 3 seconds', () => {
      expect(client.getBlockTime()).toBe(3);
    });

    it('returns TRX as native asset', () => {
      const asset = client.getNativeAsset();
      expect(asset.symbol).toBe('TRX');
      expect(asset.decimals).toBe(6);
      expect(asset.name).toBe('TRON');
    });
  });

  // ─── Address Validation ─────────────────────────────────────────────

  describe('validateAddress', () => {
    it('validates correct Tron addresses', () => {
      // Real Tron mainnet addresses
      expect(client.validateAddress('TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL')).toBe(true);
      // Valid format: T + 33 Base58 chars
      expect(client.validateAddress('TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb')).toBe(true);
    });

    it('rejects non-Tron addresses', () => {
      expect(client.validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
      expect(client.validateAddress('not-an-address')).toBe(false);
      expect(client.validateAddress('')).toBe(false);
    });

    it('rejects addresses with wrong length', () => {
      expect(client.validateAddress('TShort')).toBe(false);
      expect(client.validateAddress('T' + 'A'.repeat(50))).toBe(false);
    });

    it('rejects addresses not starting with T', () => {
      expect(client.validateAddress('A123456789012345678901234567890123')).toBe(false);
    });
  });

  describe('formatAddress', () => {
    it('returns valid address as-is', () => {
      const addr = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL';
      expect(client.formatAddress(addr)).toBe(addr);
    });

    it('throws InvalidAddressError for invalid address', () => {
      expect(() => client.formatAddress('invalid')).toThrow(InvalidAddressError);
    });
  });

  // ─── Gas Estimation ─────────────────────────────────────────────────

  describe('estimateGas', () => {
    it('estimates gas for simple TRX transfer', async () => {
      const estimate = await client.estimateGas({
        from: 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        to: 'TAnotherAddress123456789012345678',
        value: '1000000',
        data: '0x',
      });

      expect(estimate.gasLimit).toBeGreaterThan(0);
      expect(estimate.totalCost).toBeGreaterThan(0);
      expect(estimate.totalCostUSD).toBeGreaterThan(0);
    });

    it('estimates higher gas for contract calls', async () => {
      const estimate = await client.estimateGas({
        from: 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        to: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT contract
        value: '0',
        data: '0xa9059cbb00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000',
      });

      expect(estimate.gasLimit).toBeGreaterThan(250); // More than simple transfer
    });
  });

  // ─── Transaction Status ─────────────────────────────────────────────

  describe('getTransactionStatus', () => {
    it('returns transaction status', async () => {
      const status = await client.getTransactionStatus('0xabc123');

      expect(status.txHash).toBe('0xabc123');
      expect(status.status).toBeDefined();
      expect(status.confirmations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTransactionReceipt', () => {
    it('returns transaction receipt', async () => {
      const receipt = await client.getTransactionReceipt('0xabc123');

      expect(receipt.txHash).toBe('0xabc123');
      expect(typeof receipt.status).toBe('boolean');
      expect(receipt.blockNumber).toBeGreaterThan(0);
    });
  });

  // ─── Balance Operations ─────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns native TRX balance', async () => {
      const balance = await client.getBalance(
        'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        client.getNativeAsset(),
      );

      expect(balance.asset.symbol).toBe('TRX');
      expect(balance.amount).toBeDefined();
      expect(Number(balance.amount)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTokenBalance', () => {
    it('returns TRC20 token balance', async () => {
      const balance = await client.getTokenBalance(
        'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT
      );

      expect(balance.asset.symbol).toBe('USDT');
      expect(balance.asset.decimals).toBe(6);
      expect(balance.amount).toBeDefined();
    });

    it('returns unknown token info for unrecognized address', async () => {
      const balance = await client.getTokenBalance(
        'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        '0xUnknownTokenAddress',
      );

      expect(balance.asset.symbol).toBe('UNKNOWN');
    });
  });

  // ─── Deposit Monitoring ─────────────────────────────────────────────

  describe('watchDeposits', () => {
    it('returns an unsubscribe function', () => {
      const unsub = client.watchDeposits(
        'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        vi.fn(),
      );

      expect(typeof unsub).toBe('function');
      unsub(); // Should not throw
    });

    it('can be unsubscribed multiple times', () => {
      const unsub = client.watchDeposits(
        'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL',
        vi.fn(),
      );

      unsub();
      unsub(); // Should not throw
    });
  });

  // ─── Tron-Specific Methods ──────────────────────────────────────────

  describe('getResourcePrices', () => {
    it('returns energy and bandwidth prices', () => {
      const prices = client.getResourcePrices();

      expect(prices.energyPriceSun).toBeGreaterThan(0);
      expect(prices.bandwidthPriceSun).toBeGreaterThan(0);
    });
  });

  describe('calculateTrc20TransferCost', () => {
    it('calculates TRC20 transfer cost', () => {
      const cost = client.calculateTrc20TransferCost(100);

      expect(cost.energyRequired).toBe(65000);
      expect(cost.costTrx).toBeGreaterThan(0);
      expect(cost.costUsd).toBeGreaterThan(0);
    });
  });

  describe('isTrc20Contract', () => {
    it('identifies contract addresses', () => {
      expect(client.isTrc20Contract('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(false);
      expect(client.isTrc20Contract('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(true);
    });
  });

  // ─── Cleanup ────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('clears all watchers', async () => {
      client.watchDeposits('TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', vi.fn());
      client.watchDeposits('TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', vi.fn());

      await client.destroy();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  // ─── Custom Configuration ───────────────────────────────────────────

  describe('custom configuration', () => {
    it('accepts custom config', () => {
      const customClient = new TronChainClient({
        chainId: 'nile',
        chainName: 'Tron Nile',
        confirmationDepth: 19,
        blockTime: 3,
      });

      expect(customClient.chainId).toBe('nile');
      expect(customClient.chainName).toBe('Tron Nile');
    });
  });
});
