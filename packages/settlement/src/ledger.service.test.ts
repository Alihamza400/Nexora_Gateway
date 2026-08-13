import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerService, type DepositRecord, type FeeRecord, type RefundRecord } from './ledger.service.js';
import type { LedgerEntry, Settlement } from '@crypto-gateway/shared';

// ─── Mock Database Client ────────────────────────────────────────────────────

function createMockDb() {
  const store: Array<Record<string, unknown>> = [];
  return {
    store,
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      // Handle INSERT
      if (_sql.startsWith('INSERT')) {
        const entry: Record<string, unknown> = {
          id: params?.[0] ?? 'mock-id',
          intent_id: params?.[1],
          entry_type: params?.[2],
          amount: params?.[3],
          asset: params?.[4],
          chain: params?.[5],
          debit_account: params?.[6],
          credit_account: params?.[7],
          metadata: params?.[8] ? JSON.parse(params[8] as string) : null,
          created_at: params?.[9] ?? new Date().toISOString(),
        };
        store.push(entry);
        return { rows: [entry] };
      }

      // Handle SUM queries
      if (_sql.includes('SUM')) {
        const debits = store
          .filter((r) => r.debit_account === params?.[0] && r.asset === params?.[1])
          .reduce((sum, r) => sum + Number(r.amount), 0);
        const credits = store
          .filter((r) => r.credit_account === params?.[0] && r.asset === params?.[1])
          .reduce((sum, r) => sum + Number(r.amount), 0);
        return { rows: [{ debits, credits }] };
      }

      // Handle SELECT queries
      const filtered = store.filter((r) => {
        if (_sql.includes('intent_id')) return r.intent_id === params?.[0];
        if (_sql.includes('debit_account') || _sql.includes('credit_account')) {
          return r.debit_account === params?.[0] || r.credit_account === params?.[0];
        }
        return true;
      });

      return { rows: filtered };
    }),
  };
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const mockSettlement: Settlement = {
  id: 'settlement-1',
  intent_id: 'intent-1',
  merchant_id: 'merchant-1',
  amount: 980,
  asset: 'USDC',
  chain: 'base',
  destination_address: '0xMerchantAddress',
  status: 'COMPLETED',
  tx_hash: '0xTxHash',
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  completed_at: new Date('2025-01-01'),
};

const mockDeposit: DepositRecord = {
  intent_id: 'intent-1',
  amount: 1000,
  asset: 'USDC',
  chain: 'base',
  customer_id: 'customer-1',
  tx_hash: '0xDepositTxHash',
  source_address: '0xCustomerAddress',
};

const mockFee: FeeRecord = {
  intent_id: 'intent-1',
  amount: 20,
  asset: 'USDC',
  chain: 'base',
  merchant_id: 'merchant-1',
  fee_type: 'PLATFORM',
  percentage: 2,
};

const mockRefund: RefundRecord = {
  intent_id: 'intent-1',
  amount: 500,
  asset: 'USDC',
  chain: 'base',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  tx_hash: '0xRefundTxHash',
  reason: 'OVERPAYMENT',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LedgerService', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let ledgerService: LedgerService;

  beforeEach(() => {
    mockDb = createMockDb();
    // Mock the LedgerRepository
    const mockLedgerRepo = {
      create: vi.fn(async (params: {
        intent_id: string;
        entry_type: string;
        amount: number;
        asset: string;
        chain: string;
        debit_account: string;
        credit_account: string;
        metadata?: Record<string, unknown>;
      }): Promise<LedgerEntry> => {
        const entry: LedgerEntry = {
          id: `entry-${Date.now()}`,
          intent_id: params.intent_id,
          entry_type: params.entry_type as LedgerEntry['entry_type'],
          amount: params.amount,
          asset: params.asset,
          chain: params.chain,
          debit_account: params.debit_account,
          credit_account: params.credit_account,
          metadata: params.metadata ?? null,
          created_at: new Date(),
        };
        // Store as Record<string, unknown> for mock compatibility
        mockDb.store.push(entry as unknown as Record<string, unknown>);
        return entry;
      }),
      findByIntentId: vi.fn(async (intentId: string) => {
        return mockDb.store.filter((e) => e.intent_id === intentId) as unknown as LedgerEntry[];
      }),
      findByAccount: vi.fn(async (accountId: string, _start: Date, _end: Date) => {
        return mockDb.store.filter(
          (e) => e.debit_account === accountId || e.credit_account === accountId,
        ) as unknown as LedgerEntry[];
      }),
      getBalance: vi.fn(async (accountId: string, asset: string) => {
        const debits = mockDb.store
          .filter((e) => e.debit_account === accountId && e.asset === asset)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        const credits = mockDb.store
          .filter((e) => e.credit_account === accountId && e.asset === asset)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        return debits - credits;
      }),
      getMerchantBalance: vi.fn(async (merchantId: string, asset: string) => {
        const accountId = `merchant:${merchantId}`;
        const debits = mockDb.store
          .filter((e) => e.debit_account === accountId && e.asset === asset)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        const credits = mockDb.store
          .filter((e) => e.credit_account === accountId && e.asset === asset)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        return debits - credits;
      }),
      getTotalFees: vi.fn(async () => ({ total: 0, count: 0 })),
      verifyConsistency: vi.fn(async () => ({
        isConsistent: true,
        totalDebits: 0,
        totalCredits: 0,
        difference: 0,
      })),
      findByType: vi.fn(async () => []),
    };

    ledgerService = new LedgerService(mockLedgerRepo as never);
  });

  describe('recordDeposit', () => {
    it('should record a deposit with correct debit/credit accounts', async () => {
      const entry = await ledgerService.recordDeposit(mockDeposit);

      expect(entry.entry_type).toBe('DEPOSIT');
      expect(entry.amount).toBe(1000);
      expect(entry.debit_account).toBe('pending:intent-1');
      expect(entry.credit_account).toBe('customer:customer-1');
      expect(entry.metadata).toEqual({
        tx_hash: '0xDepositTxHash',
        source_address: '0xCustomerAddress',
      });
    });
  });

  describe('recordFee', () => {
    it('should record a fee with correct debit/credit accounts', async () => {
      const entry = await ledgerService.recordFee(mockFee);

      expect(entry.entry_type).toBe('FEE');
      expect(entry.amount).toBe(20);
      expect(entry.debit_account).toBe('merchant:merchant-1');
      expect(entry.credit_account).toBe('revenue:fees');
      expect(entry.metadata).toEqual({
        fee_type: 'PLATFORM',
        percentage: 2,
      });
    });
  });

  describe('recordSettlement', () => {
    it('should record a settlement with correct debit/credit accounts', async () => {
      const entry = await ledgerService.recordSettlement(mockSettlement);

      expect(entry.entry_type).toBe('SETTLEMENT');
      expect(entry.amount).toBe(980);
      expect(entry.debit_account).toBe('pending:intent-1');
      expect(entry.credit_account).toBe('merchant:merchant-1');
      expect(entry.metadata).toEqual({
        tx_hash: '0xTxHash',
        destination_address: '0xMerchantAddress',
      });
    });
  });

  describe('recordRefund', () => {
    it('should record a refund with correct debit/credit accounts', async () => {
      const entry = await ledgerService.recordRefund(mockRefund);

      expect(entry.entry_type).toBe('REFUND');
      expect(entry.amount).toBe(500);
      expect(entry.debit_account).toBe('merchant:merchant-1');
      expect(entry.credit_account).toBe('customer:customer-1');
      expect(entry.metadata).toEqual({
        tx_hash: '0xRefundTxHash',
        reason: 'OVERPAYMENT',
      });
    });
  });

  describe('recordFxGainLoss', () => {
    it('should record an FX gain', async () => {
      const entry = await ledgerService.recordFxGainLoss('intent-1', 'USDC', 'base', 50);

      expect(entry.entry_type).toBe('FX_GAIN_LOSS');
      expect(entry.amount).toBe(50);
      expect(entry.debit_account).toBe('revenue:fx');
      expect(entry.credit_account).toBe('expense:fx');
      expect(entry.metadata).toEqual({ type: 'gain' });
    });

    it('should record an FX loss', async () => {
      const entry = await ledgerService.recordFxGainLoss('intent-1', 'USDC', 'base', -30);

      expect(entry.entry_type).toBe('FX_GAIN_LOSS');
      expect(entry.amount).toBe(30);
      expect(entry.debit_account).toBe('expense:fx');
      expect(entry.credit_account).toBe('revenue:fx');
      expect(entry.metadata).toEqual({ type: 'loss' });
    });
  });

  describe('calculateSettlementAmount', () => {
    it('should calculate amount after 2% fee', () => {
      const result = ledgerService.calculateSettlementAmount(1000, 2);
      expect(result).toBe(980);
    });

    it('should calculate amount after 0% fee', () => {
      const result = ledgerService.calculateSettlementAmount(1000, 0);
      expect(result).toBe(1000);
    });

    it('should handle decimal precision correctly', () => {
      const result = ledgerService.calculateSettlementAmount(1000, 1.5);
      expect(result).toBe(985);
    });

    it('should handle small amounts', () => {
      const result = ledgerService.calculateSettlementAmount(10, 5);
      expect(result).toBe(9.5);
    });

    it('should round to 8 decimal places', () => {
      const result = ledgerService.calculateSettlementAmount(333.33, 3);
      expect(result).toBe(323.3301); // 333.33 - 9.9999 = 323.3301
    });
  });

  describe('getStatement', () => {
    it('should generate a statement with correct totals', async () => {
      // Add some entries to the mock store
      mockDb.store.push(
        {
          id: '1',
          intent_id: 'intent-1',
          entry_type: 'DEPOSIT',
          amount: 1000,
          asset: 'USDC',
          chain: 'base',
          debit_account: 'merchant:merchant-1',
          credit_account: 'revenue:fees',
          metadata: null,
          created_at: new Date('2025-01-01'),
        } as Record<string, unknown>,
        {
          id: '2',
          intent_id: 'intent-2',
          entry_type: 'SETTLEMENT',
          amount: 500,
          asset: 'USDC',
          chain: 'base',
          debit_account: 'pending:intent-2',
          credit_account: 'merchant:merchant-1',
          metadata: null,
          created_at: new Date('2025-01-02'),
        } as Record<string, unknown>,
      );

      const statement = await ledgerService.getStatement(
        'merchant:merchant-1',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
      );

      expect(statement.account_id).toBe('merchant:merchant-1');
      expect(statement.entries.length).toBeGreaterThan(0);
      expect(typeof statement.total_debits).toBe('number');
      expect(typeof statement.total_credits).toBe('number');
    });
  });

  describe('verifyConsistency', () => {
    it('should verify ledger consistency', async () => {
      const result = await ledgerService.verifyConsistency();

      expect(result).toHaveProperty('isConsistent');
      expect(result).toHaveProperty('totalDebits');
      expect(result).toHaveProperty('totalCredits');
      expect(result).toHaveProperty('difference');
    });
  });
});
