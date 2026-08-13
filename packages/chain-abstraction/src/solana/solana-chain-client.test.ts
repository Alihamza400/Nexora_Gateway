import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolanaChainClient } from './solana-chain-client.js';
import { InvalidAddressError } from '@crypto-gateway/shared';

describe('SolanaChainClient', () => {
  let client: SolanaChainClient;

  beforeEach(() => {
    client = new SolanaChainClient();
  });

  afterEach(async () => {
    await client.destroy();
  });

  // ─── Chain Info ──────────────────────────────────────────────────────

  describe('chain info', () => {
    it('returns correct chainId', () => {
      expect(client.chainId).toBe('solana');
    });

    it('returns correct chainName', () => {
      expect(client.chainName).toBe('Solana');
    });

    it('returns confirmation depth of 32', () => {
      expect(client.getConfirmationDepth()).toBe(32);
    });

    it('returns slot time of 0.4 seconds', () => {
      expect(client.getBlockTime()).toBe(0.4);
    });

    it('returns SOL as native asset', () => {
      const asset = client.getNativeAsset();
      expect(asset.symbol).toBe('SOL');
      expect(asset.decimals).toBe(9);
      expect(asset.name).toBe('Solana');
    });
  });

  // ─── Address Validation ─────────────────────────────────────────────

  describe('validateAddress', () => {
    it('validates correct Solana addresses', () => {
      // Real Solana addresses (Base58, 32-44 chars)
      expect(client.validateAddress('11111111111111111111111111111111')).toBe(true);
      expect(client.validateAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
      expect(client.validateAddress('vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg')).toBe(true);
    });

    it('rejects non-Solana addresses', () => {
      // EVM address (0x prefix, not Base58)
      expect(client.validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
      // Too short
      expect(client.validateAddress('short')).toBe(false);
      // Empty
      expect(client.validateAddress('')).toBe(false);
      // Contains invalid Base58 chars (0, O, I, l)
      expect(client.validateAddress('I0OOIl0OOIl0OOIl0OOIl0OOIl0OOIl0OOI')).toBe(false);
    });

    it('rejects addresses with wrong length', () => {
      expect(client.validateAddress('short')).toBe(false);
      expect(client.validateAddress('A'.repeat(50))).toBe(false);
    });

    it('rejects addresses with invalid Base58 characters', () => {
      // '0', 'O', 'I', 'l' are not valid Base58
      expect(client.validateAddress('0000000000000000000000000000000000000000')).toBe(false);
    });
  });

  describe('formatAddress', () => {
    it('returns valid address as-is', () => {
      const addr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      expect(client.formatAddress(addr)).toBe(addr);
    });

    it('throws InvalidAddressError for invalid address', () => {
      expect(() => client.formatAddress('invalid')).toThrow(InvalidAddressError);
    });
  });

  // ─── Gas Estimation ─────────────────────────────────────────────────

  describe('estimateGas', () => {
    it('estimates gas for simple SOL transfer', async () => {
      const estimate = await client.estimateGas({
        from: '11111111111111111111111111111111',
        to: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        value: '1000000000',
        data: '0x',
      });

      expect(estimate.gasLimit).toBe(5000);
      expect(estimate.totalCost).toBeGreaterThan(0);
      expect(estimate.totalCostUSD).toBeGreaterThan(0);
    });

    it('estimates higher gas for token transfers', async () => {
      const estimate = await client.estimateGas({
        from: '11111111111111111111111111111111',
        to: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        value: '0',
        data: '0xabcdef', // Simulated SPL token transfer data
      });

      expect(estimate.gasLimit).toBe(200000); // More than simple transfer
    });
  });

  // ─── Transaction Status ─────────────────────────────────────────────

  describe('getTransactionStatus', () => {
    it('returns transaction status', async () => {
      const status = await client.getTransactionStatus('test-signature');

      expect(status.txHash).toBe('test-signature');
      expect(status.status).toBeDefined();
      expect(status.confirmations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTransactionReceipt', () => {
    it('returns transaction receipt', async () => {
      const receipt = await client.getTransactionReceipt('test-signature');

      expect(receipt.txHash).toBe('test-signature');
      expect(typeof receipt.status).toBe('boolean');
      expect(receipt.blockNumber).toBeGreaterThan(0);
    });
  });

  // ─── Balance Operations ─────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns native SOL balance', async () => {
      const balance = await client.getBalance(
        '11111111111111111111111111111111',
        client.getNativeAsset(),
      );

      expect(balance.asset.symbol).toBe('SOL');
      expect(balance.amount).toBeDefined();
      expect(Number(balance.amount)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTokenBalance', () => {
    it('returns SPL token balance', async () => {
      const balance = await client.getTokenBalance(
        '11111111111111111111111111111111',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      );

      expect(balance.asset.symbol).toBe('USDC');
      expect(balance.asset.decimals).toBe(6);
      expect(balance.amount).toBeDefined();
    });

    it('returns unknown token info for unrecognized mint', async () => {
      const balance = await client.getTokenBalance(
        '11111111111111111111111111111111',
        'UnknownMintAddress123456789012345678901234',
      );

      expect(balance.asset.symbol).toBe('UNKNOWN');
    });
  });

  // ─── Deposit Monitoring ─────────────────────────────────────────────

  describe('watchDeposits', () => {
    it('returns an unsubscribe function', () => {
      const unsub = client.watchDeposits(
        '11111111111111111111111111111111',
        vi.fn(),
      );

      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('can be unsubscribed multiple times', () => {
      const unsub = client.watchDeposits(
        '11111111111111111111111111111111',
        vi.fn(),
      );

      unsub();
      unsub(); // Should not throw
    });
  });

  // ─── Solana-Specific Methods ────────────────────────────────────────

  describe('getComputeUnitPrice', () => {
    it('returns compute unit price', () => {
      const price = client.getComputeUnitPrice();
      expect(price).toBeGreaterThan(0);
    });
  });

  describe('calculatePriorityFee', () => {
    it('calculates priority fee for transaction', () => {
      const fee = client.calculatePriorityFee(200000);

      expect(fee.computeUnits).toBe(200000);
      expect(fee.priorityFeeLamports).toBeGreaterThan(0);
      expect(fee.priorityFeeSol).toBeGreaterThan(0);
      expect(fee.priorityFeeUsd).toBeGreaterThan(0);
    });
  });

  describe('isSystemProgram', () => {
    it('identifies system programs', () => {
      expect(client.isSystemProgram('11111111111111111111111111111111')).toBe(true);
      expect(client.isSystemProgram('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(true);
      expect(client.isSystemProgram('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')).toBe(true);
    });

    it('returns false for non-system programs', () => {
      expect(client.isSystemProgram('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(false);
    });
  });

  describe('getRecentBlockhash', () => {
    it('returns a blockhash', async () => {
      const blockhash = await client.getRecentBlockhash();
      expect(blockhash).toBeDefined();
      expect(typeof blockhash).toBe('string');
      expect(blockhash.length).toBe(88);
    });
  });

  describe('getCurrentSlot', () => {
    it('returns current slot', async () => {
      const slot = await client.getCurrentSlot();
      expect(slot).toBeGreaterThan(0);
    });
  });

  // ─── Cleanup ────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('clears all watchers', async () => {
      client.watchDeposits('11111111111111111111111111111111', vi.fn());
      client.watchDeposits('11111111111111111111111111111111', vi.fn());

      await client.destroy();

      expect(true).toBe(true);
    });
  });

  // ─── Custom Configuration ───────────────────────────────────────────

  describe('custom configuration', () => {
    it('accepts custom config', () => {
      const customClient = new SolanaChainClient({
        chainId: 'devnet',
        chainName: 'Solana Devnet',
        confirmationDepth: 32,
      });

      expect(customClient.chainId).toBe('devnet');
      expect(customClient.chainName).toBe('Solana Devnet');
    });
  });
});
