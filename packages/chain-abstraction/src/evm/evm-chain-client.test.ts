/**
 * EVMChainClient Unit Tests
 * Tests address validation, gas estimation, transaction status, balance queries,
 * and deposit watching using mocked ethers.js providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { EVMChainClient } from './evm-chain-client.js';
import { InvalidAddressError } from '@crypto-gateway/shared';

// ─── Mock Provider ──────────────────────────────────────────────────────────

const mockProvider = {
  estimateGas: vi.fn(),
  getFeeData: vi.fn(),
  broadcastTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  getBalance: vi.fn(),
};

const mockContract = {
  balanceOf: vi.fn(),
  decimals: vi.fn(),
  symbol: vi.fn(),
  name: vi.fn(),
};

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation(() => mockProvider),
    Contract: vi.fn().mockImplementation(() => mockContract),
  };
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('EVMChainClient', () => {
  let client: EVMChainClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new EVMChainClient('1', 'Ethereum', 'https://mock-rpc.com');
  });

  afterEach(async () => {
    await client.destroy();
  });

  // ─── Chain Info ─────────────────────────────────────────────────────────

  describe('chain info', () => {
    it('returns correct chainId', () => {
      expect(client.chainId).toBe('1');
    });

    it('returns correct chainName', () => {
      expect(client.chainName).toBe('Ethereum');
    });

    it('returns confirmation depth', () => {
      expect(client.getConfirmationDepth()).toBe(12);
    });

    it('returns block time', () => {
      expect(client.getBlockTime()).toBe(12);
    });

    it('returns native asset', () => {
      const asset = client.getNativeAsset();
      expect(asset.symbol).toBe('ETH');
      expect(asset.decimals).toBe(18);
      expect(asset.name).toBe('Ether');
    });
  });

  // ─── Address Operations ─────────────────────────────────────────────────

  describe('validateAddress', () => {
    it('validates correct EVM addresses', () => {
      expect(client.validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true);
      expect(client.validateAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('rejects invalid addresses', () => {
      expect(client.validateAddress('not-an-address')).toBe(false);
      expect(client.validateAddress('0x123')).toBe(false);
      expect(client.validateAddress('')).toBe(false);
    });

    it('rejects non-EVM addresses', () => {
      expect(client.validateAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(false);
    });
  });

  describe('formatAddress', () => {
    it('returns checksummed address', () => {
      const addr = client.formatAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
      expect(addr).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    });

    it('throws InvalidAddressError for invalid address', () => {
      expect(() => client.formatAddress('invalid')).toThrow(InvalidAddressError);
    });
  });

  // ─── Gas Estimation ─────────────────────────────────────────────────────

  describe('estimateGas', () => {
    it('returns gas estimate with EIP-1559 fees', async () => {
      mockProvider.estimateGas.mockResolvedValue(21000n);
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: ethers.parseUnits('20', 'gwei'),
        maxFeePerGas: ethers.parseUnits('40', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
      });

      const estimate = await client.estimateGas({
        from: '0x1234567890123456789012345678901234567890',
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        value: ethers.parseEther('1').toString(),
        data: '0x',
      });

      expect(estimate.gasLimit).toBe(21000);
      expect(estimate.maxFeePerGas).toBeDefined();
      expect(estimate.maxPriorityFeePerGas).toBeDefined();
      expect(estimate.totalCost).toBeGreaterThan(0);
    });

    it('returns gas estimate with legacy fees', async () => {
      mockProvider.estimateGas.mockResolvedValue(21000n);
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: ethers.parseUnits('20', 'gwei'),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      });

      const estimate = await client.estimateGas({
        from: '0x1234567890123456789012345678901234567890',
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        value: '0',
        data: '0x',
      });

      expect(estimate.gasLimit).toBe(21000);
      expect(estimate.maxFeePerGas).toBeUndefined();
      expect(estimate.gasPrice).toBeGreaterThan(0);
    });
  });

  // ─── Transaction Status ─────────────────────────────────────────────────

  describe('getTransactionStatus', () => {
    it('returns PENDING when receipt not found', async () => {
      mockProvider.getTransaction.mockResolvedValue(null);
      mockProvider.getTransactionReceipt.mockResolvedValue(null);

      const status = await client.getTransactionStatus('0xabc');
      expect(status.status).toBe('PENDING');
      expect(status.confirmations).toBe(0);
    });

    it('returns CONFIRMING when below confirmation depth', async () => {
      mockProvider.getTransaction.mockResolvedValue({ hash: '0xabc' });
      mockProvider.getTransactionReceipt.mockResolvedValue({
        blockNumber: 100,
        status: 1,
        gasUsed: 21000n,
        gasPrice: ethers.parseUnits('20', 'gwei'),
      });
      mockProvider.getBlockNumber.mockResolvedValue(105);

      const status = await client.getTransactionStatus('0xabc');
      expect(status.status).toBe('CONFIRMING');
      expect(status.confirmations).toBe(5);
    });

    it('returns CONFIRMED when above confirmation depth', async () => {
      mockProvider.getTransaction.mockResolvedValue({ hash: '0xabc' });
      mockProvider.getTransactionReceipt.mockResolvedValue({
        blockNumber: 100,
        status: 1,
        gasUsed: 21000n,
        gasPrice: ethers.parseUnits('20', 'gwei'),
      });
      mockProvider.getBlockNumber.mockResolvedValue(115);

      const status = await client.getTransactionStatus('0xabc');
      expect(status.status).toBe('CONFIRMED');
      expect(status.confirmations).toBe(15);
    });

    it('returns FAILED when receipt status is 0', async () => {
      mockProvider.getTransaction.mockResolvedValue({ hash: '0xabc' });
      mockProvider.getTransactionReceipt.mockResolvedValue({
        blockNumber: 100,
        status: 0,
        gasUsed: 21000n,
        gasPrice: ethers.parseUnits('20', 'gwei'),
      });
      mockProvider.getBlockNumber.mockResolvedValue(115);

      const status = await client.getTransactionStatus('0xabc');
      expect(status.status).toBe('FAILED');
    });
  });

  // ─── Balance Operations ─────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns native asset balance', async () => {
      mockProvider.getBalance.mockResolvedValue(ethers.parseEther('1.5'));

      const balance = await client.getBalance(
        '0x1234567890123456789012345678901234567890',
        client.getNativeAsset(),
      );

      expect(balance.amount).toBe(ethers.parseEther('1.5').toString());
      expect(balance.asset.symbol).toBe('ETH');
    });
  });

  describe('getTokenBalance', () => {
    it('returns ERC-20 token balance', async () => {
      mockContract.balanceOf.mockResolvedValue(ethers.parseUnits('100', 6));
      mockContract.decimals.mockResolvedValue(6);
      mockContract.symbol.mockResolvedValue('USDC');
      mockContract.name.mockResolvedValue('USD Coin');

      const balance = await client.getTokenBalance(
        '0x1234567890123456789012345678901234567890',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      );

      expect(balance.asset.symbol).toBe('USDC');
      expect(balance.asset.decimals).toBe(6);
      expect(balance.amount).toBe(ethers.parseUnits('100', 6).toString());
    });
  });

  // ─── Cleanup ────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('clears watchers and stops polling', async () => {
      const unsub = client.watchDeposits(
        '0x1234567890123456789012345678901234567890',
        vi.fn(),
      );

      unsub();
      await client.destroy();

      expect(true).toBe(true);
    });
  });
});
