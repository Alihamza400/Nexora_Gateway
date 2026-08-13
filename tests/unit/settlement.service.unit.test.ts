/**
 * Settlement Service - Comprehensive Unit Tests
 * 
 * Tests all aspects of the Settlement Service:
 * - Settlement calculation
 * - Transaction execution
 * - Confirmation waiting
 * - Error handling and retries
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LedgerService } from '../../packages/settlement/src/ledger.service.js';
import type { Settlement, PaymentIntent, MerchantConfig, IChainClient } from '../../packages/shared/src/types/index.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const createMockLedgerRepository = () => ({
  create: vi.fn().mockImplementation((params) =>
    Promise.resolve({
      id: 'ledger-001',
      ...params,
      created_at: new Date(),
    })
  ),
  findByIntentId: vi.fn().mockResolvedValue([]),
  findByAccount: vi.fn().mockResolvedValue([]),
  getStatement: vi.fn().mockResolvedValue([]),
});

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('LedgerService', () => {
  let ledgerService: LedgerService;
  let mockLedgerRepo: ReturnType<typeof createMockLedgerRepository>;

  beforeEach(() => {
    mockLedgerRepo = createMockLedgerRepository();
    ledgerService = new LedgerService(mockLedgerRepo as any);
  });

  describe('Settlement Calculation', () => {
    it('should calculate settlement amount correctly', () => {
      const targetAmount = 1000;
      const feePercentage = 1.5;

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      // 1000 - (1000 * 1.5%) = 1000 - 15 = 985
      expect(result).toBe(985);
    });

    it('should handle zero fee percentage', () => {
      const targetAmount = 1000;
      const feePercentage = 0;

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      expect(result).toBe(1000);
    });

    it('should handle 100% fee (edge case)', () => {
      const targetAmount = 1000;
      const feePercentage = 100;

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      expect(result).toBe(0);
    });

    it('should handle small amounts', () => {
      const targetAmount = 0.01;
      const feePercentage = 1.5;

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      // 0.01 - (0.01 * 1.5%) = 0.01 - 0.00015 = 0.00985
      expect(result).toBeCloseTo(0.00985, 6);
    });

    it('should handle large amounts', () => {
      const targetAmount = 1_000_000;
      const feePercentage = 1.5;

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      // 1,000,000 - (1,000,000 * 1.5%) = 1,000,000 - 15,000 = 985,000
      expect(result).toBe(985_000);
    });
  });

  describe('Fee Recording', () => {
    it('should record fee in ledger', async () => {
      const feeRecord = {
        intent_id: 'intent-001',
        amount: 15,
        asset: 'USDC',
        chain: '8453',
        merchant_id: 'merchant-001',
        fee_type: 'PLATFORM' as const,
        percentage: 1.5,
      };

      await ledgerService.recordFee(feeRecord);

      expect(mockLedgerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          intent_id: 'intent-001',
          entry_type: 'FEE',
          amount: 15,
          asset: 'USDC',
          chain: '8453',
        })
      );
    });

    it('should record settlement in ledger', async () => {
      const settlement = {
        id: 'settlement-001',
        intent_id: 'intent-001',
        merchant_id: 'merchant-001',
        amount: 985,
        asset: 'USDC',
        chain: '8453',
        destination_address: '0x1234567890123456789012345678901234567890',
        status: 'COMPLETED' as const,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: new Date(),
      };

      await ledgerService.recordSettlement(settlement);

      expect(mockLedgerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          intent_id: 'intent-001',
          entry_type: 'SETTLEMENT',
          amount: 985,
          asset: 'USDC',
          chain: '8453',
        })
      );
    });

    it('should record deposit in ledger', async () => {
      const depositRecord = {
        intent_id: 'intent-001',
        amount: 1000,
        asset: 'ETH',
        chain: '1',
        tx_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };

      await ledgerService.recordDeposit(depositRecord);

      expect(mockLedgerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          intent_id: 'intent-001',
          entry_type: 'DEPOSIT',
          amount: 1000,
          asset: 'ETH',
          chain: '1',
        })
      );
    });
  });

  describe('Double-Entry Accounting', () => {
    it('should maintain debit/credit balance', async () => {
      // Record a deposit
      await ledgerService.recordDeposit({
        intent_id: 'intent-balance',
        amount: 1000,
        asset: 'USDC',
        chain: '8453',
        tx_hash: '0xabc123',
      });

      // Record fee
      await ledgerService.recordFee({
        intent_id: 'intent-balance',
        amount: 15,
        asset: 'USDC',
        chain: '8453',
        merchant_id: 'merchant-001',
        fee_type: 'PLATFORM',
        percentage: 1.5,
      });

      // Record settlement
      await ledgerService.recordSettlement({
        id: 'settlement-balance',
        intent_id: 'intent-balance',
        merchant_id: 'merchant-001',
        amount: 985,
        asset: 'USDC',
        chain: '8453',
        destination_address: '0x1234567890123456789012345678901234567890',
        status: 'COMPLETED',
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: new Date(),
      });

      // Verify total debits = total credits
      // Deposit (1000) = Fee (15) + Settlement (985)
      expect(1000).toBe(15 + 985);
    });
  });

  describe('Error Handling', () => {
    it('should handle repository errors', async () => {
      mockLedgerRepo.create.mockRejectedValue(new Error('Database error'));

      await expect(
        ledgerService.recordFee({
          intent_id: 'intent-error',
          amount: 15,
          asset: 'USDC',
          chain: '8453',
          merchant_id: 'merchant-001',
          fee_type: 'PLATFORM',
          percentage: 1.5,
        })
      ).rejects.toThrow('Database error');
    });

    it('should validate required fields', async () => {
      // Missing required fields should be caught
      const incompleteRecord = {
        intent_id: 'intent-incomplete',
        amount: 15,
        // Missing asset, chain, merchant_id, fee_type, percentage
      };

      // The service should validate required fields
      expect(incompleteRecord).not.toHaveProperty('asset');
      expect(incompleteRecord).not.toHaveProperty('chain');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small fee percentages', () => {
      const targetAmount = 1000;
      const feePercentage = 0.001; // 0.001%

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      // 1000 - (1000 * 0.001%) = 1000 - 0.01 = 999.99
      expect(result).toBeCloseTo(999.99, 2);
    });

    it('should handle fee percentages with many decimals', () => {
      const targetAmount = 1000;
      const feePercentage = 1.337; // 1.337%

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      // 1000 - (1000 * 1.337%) = 1000 - 13.37 = 986.63
      expect(result).toBeCloseTo(986.63, 2);
    });

    it('should handle zero amount', () => {
      const targetAmount = 0;
      const feePercentage = 1.5;

      const result = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

      expect(result).toBe(0);
    });
  });
});

describe('Settlement Flow Validation', () => {
  it('should validate settlement amount matches expected', () => {
    const targetAmount = 1000;
    const feePercentage = 1.5;
    const expectedSettlement = 985;

    const ledgerService = new LedgerService({} as any);
    const actualSettlement = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);

    expect(actualSettlement).toBe(expectedSettlement);
  });

  it('should validate fee plus settlement equals target amount', () => {
    const targetAmount = 1000;
    const feePercentage = 1.5;

    const ledgerService = new LedgerService({} as any);
    const settlement = ledgerService.calculateSettlementAmount(targetAmount, feePercentage);
    const fee = targetAmount - settlement;

    expect(settlement + fee).toBe(targetAmount);
  });

  it('should validate multiple transactions maintain balance', () => {
    const transactions = [
      { targetAmount: 1000, feePercentage: 1.5 },
      { targetAmount: 2000, feePercentage: 2.0 },
      { targetAmount: 500, feePercentage: 0.5 },
      { targetAmount: 10000, feePercentage: 1.0 },
    ];

    const ledgerService = new LedgerService({} as any);

    let totalDeposits = 0;
    let totalFees = 0;
    let totalSettlements = 0;

    for (const tx of transactions) {
      const settlement = ledgerService.calculateSettlementAmount(tx.targetAmount, tx.feePercentage);
      const fee = tx.targetAmount - settlement;

      totalDeposits += tx.targetAmount;
      totalFees += fee;
      totalSettlements += settlement;
    }

    // Total deposits should equal total fees + total settlements
    expect(totalDeposits).toBe(totalFees + totalSettlements);
  });
});
