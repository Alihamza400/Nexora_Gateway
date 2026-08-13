import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettlementService } from './settlement.service.js';
import type { Settlement, PaymentIntent, MerchantConfig, IChainClient, TxResult, GasEstimate } from '@crypto-gateway/shared';

// ─── Mock Repositories ───────────────────────────────────────────────────────

function createMockSettlementRepo() {
  const store: Settlement[] = [];
  return {
    store,
    create: vi.fn(async (params: {
      intent_id: string;
      merchant_id: string;
      amount: number;
      asset: string;
      chain: string;
      destination_address: string;
    }): Promise<Settlement> => {
      const settlement: Settlement = {
        id: `settlement-${Date.now()}`,
        intent_id: params.intent_id,
        merchant_id: params.merchant_id,
        amount: params.amount,
        asset: params.asset,
        chain: params.chain,
        destination_address: params.destination_address,
        status: 'PENDING',
        tx_hash: null,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
      };
      store.push(settlement);
      return settlement;
    }),
    update: vi.fn(async (id: string, params: { status?: Settlement['status']; tx_hash?: string; completed_at?: Date }) => {
      const settlement = store.find((s) => s.id === id);
      if (settlement) {
        if (params.status) settlement.status = params.status;
        if (params.tx_hash) settlement.tx_hash = params.tx_hash;
        if (params.completed_at) settlement.completed_at = params.completed_at;
        settlement.updated_at = new Date();
      }
      return settlement!;
    }),
    findById: vi.fn(async (id: string) => store.find((s) => s.id === id) ?? null),
    findByIntentId: vi.fn(async (intentId: string) => store.find((s) => s.intent_id === intentId) ?? null),
    findPending: vi.fn(async () => store.filter((s) => s.status === 'PENDING' || s.status === 'RETRYING')),
    findRetryable: vi.fn(async () => []),
    getMerchantSettledTotal: vi.fn(async () => ({ total: 0, count: 0 })),
  };
}

function createMockLedgerService() {
  return {
    calculateSettlementAmount: vi.fn((targetAmount: number, feePercentage: number) => {
      const fee = targetAmount * (feePercentage / 100);
      return Math.round((targetAmount - fee) * 1e8) / 1e8;
    }),
    recordFee: vi.fn(async () => ({ id: 'fee-entry' })),
    recordSettlement: vi.fn(async () => ({ id: 'settlement-entry' })),
    recordDeposit: vi.fn(async () => ({})),
    recordRefund: vi.fn(async () => ({})),
    recordFxGainLoss: vi.fn(async () => ({})),
    getBalance: vi.fn(async () => 0),
    getMerchantBalance: vi.fn(async () => 0),
    getStatement: vi.fn(async () => ({ entries: [], total_debits: 0, total_credits: 0, closing_balance: 0 })),
    getEntriesByIntent: vi.fn(async () => []),
    verifyConsistency: vi.fn(async () => ({ isConsistent: true, totalDebits: 0, totalCredits: 0, difference: 0 })),
  };
}

function createMockChainClient(overrides?: Partial<IChainClient>): IChainClient {
  return {
    chainId: 'base',
    chainName: 'Base',
    getConfirmationDepth: vi.fn(() => 1),
    getBlockTime: vi.fn(() => 2),
    getNativeAsset: vi.fn(() => ({ address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, name: 'Ether' })),
    validateAddress: vi.fn(() => true),
    formatAddress: vi.fn((addr) => addr),
    watchDeposits: vi.fn(() => () => {}),
    estimateGas: vi.fn(async (): Promise<GasEstimate> => ({
      gasLimit: 21000,
      gasPrice: 1000000000,
      maxFeePerGas: 1000000000,
      maxPriorityFeePerGas: 100000000,
      totalCost: 0.000021,
      totalCostUSD: 0.05,
    })),
    submitTransaction: vi.fn(async (): Promise<TxResult> => ({
      txHash: '0xMockTxHash',
      nonce: 1,
      blockNumber: 0,
    })),
    getTransactionStatus: vi.fn(async () => ({
      txHash: '0xMockTxHash',
      status: 'CONFIRMED' as const,
      confirmations: 12,
      blockNumber: 100,
      gasUsed: 21000,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      txHash: '0xMockTxHash',
      status: true,
      blockNumber: 100,
      blockHash: '0xBlockHash',
      gasUsed: 21000,
      effectiveGasPrice: 1000000000,
      logs: [],
    })),
    getBalance: vi.fn(async () => ({
      asset: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, name: 'Ether' },
      amount: '1000000000000000000',
      amountUSD: 2000,
    })),
    getTokenBalance: vi.fn(async () => ({
      asset: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
      amount: '1000000000',
      amountUSD: 1000,
    })),
    ...overrides,
  } as IChainClient;
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const mockIntent: PaymentIntent = {
  id: 'intent-1',
  merchant_id: 'merchant-1',
  order_ref: 'order-123',
  target_amount: 1000,
  target_asset: 'USDC',
  target_chain: 'base',
  accepted_assets: ['USDC', 'ETH'],
  quoted_rate: 1.0,
  quote_expires_at: new Date(Date.now() + 300000),
  state: 'SETTLING',
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockMerchant: MerchantConfig = {
  id: 'merchant-1',
  name: 'Test Merchant',
  settlement_asset: 'USDC',
  settlement_chain: 'base',
  settlement_address: '0xMerchantSettlementAddress',
  accepted_chains: ['base', 'ethereum'],
  accepted_assets: ['USDC', 'ETH'],
  fee_percentage: 2,
  kyc_threshold: 10000,
  quote_ttl_seconds: 300,
  webhook_url: null,
  compliance_status: 'COMPLIANT',
  created_at: new Date(),
  updated_at: new Date(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SettlementService', () => {
  let settlementRepo: ReturnType<typeof createMockSettlementRepo>;
  let ledgerService: ReturnType<typeof createMockLedgerService>;
  let settlementService: SettlementService;

  beforeEach(() => {
    settlementRepo = createMockSettlementRepo();
    ledgerService = createMockLedgerService();
    settlementService = new SettlementService(settlementRepo as never, ledgerService as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('settleIntent', () => {
    it('should calculate settlement amount correctly', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(ledgerService.calculateSettlementAmount).toHaveBeenCalledWith(1000, 2);
    });

    it('should create settlement record with PENDING status', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(settlementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          intent_id: 'intent-1',
          merchant_id: 'merchant-1',
          amount: 980,
          asset: 'USDC',
          chain: 'base',
          destination_address: '0xMerchantSettlementAddress',
        }),
      );
    });

    it('should estimate gas before submission', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(chainClient.estimateGas).toHaveBeenCalled();
    });

    it('should submit transaction to chain', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(chainClient.submitTransaction).toHaveBeenCalled();
    });

    it('should wait for confirmation depth', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(chainClient.getTransactionStatus).toHaveBeenCalled();
    });

    it('should update settlement status to COMPLETED', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(settlementRepo.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'COMPLETED' }),
      );
    });

    it('should record fee in ledger when fee > 0', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(ledgerService.recordFee).toHaveBeenCalledWith(
        expect.objectContaining({
          intent_id: 'intent-1',
          amount: 20,
          merchant_id: 'merchant-1',
          fee_type: 'PLATFORM',
          percentage: 2,
        }),
      );
    });

    it('should record settlement in ledger', async () => {
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: mockMerchant,
        chainClient,
      });

      expect(ledgerService.recordSettlement).toHaveBeenCalled();
    });

    it('should not record fee when fee_percentage is 0', async () => {
      const merchantNoFee = { ...mockMerchant, fee_percentage: 0 };
      const chainClient = createMockChainClient();

      await settlementService.settleIntent({
        intent: mockIntent,
        merchant: merchantNoFee,
        chainClient,
      });

      expect(ledgerService.recordFee).not.toHaveBeenCalled();
      expect(ledgerService.calculateSettlementAmount).toHaveBeenCalledWith(1000, 0);
    });

    it('should handle chain client errors gracefully', async () => {
      const chainClient = createMockChainClient({
        submitTransaction: vi.fn(async () => {
          throw new Error('NETWORK_ERROR: Connection refused');
        }),
      });

      await expect(
        settlementService.settleIntent({
          intent: mockIntent,
          merchant: mockMerchant,
          chainClient,
        }),
      ).rejects.toThrow();

      expect(settlementRepo.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'FAILED' }),
      );
    });
  });

  describe('retrySettlement', () => {
    it('should update status to RETRYING', async () => {
      const settlement = await settlementRepo.create({
        intent_id: 'intent-1',
        merchant_id: 'merchant-1',
        amount: 980,
        asset: 'USDC',
        chain: 'base',
        destination_address: '0xMerchantSettlementAddress',
      });

      // Mark as failed first
      settlement.status = 'FAILED';

      const result = await settlementService.retrySettlement(settlement.id);

      expect(result.status).toBe('RETRYING');
    });

    it('should throw if settlement not found', async () => {
      await expect(
        settlementService.retrySettlement('nonexistent'),
      ).rejects.toThrow();
    });
  });

  describe('getSettlement', () => {
    it('should return settlement by ID', async () => {
      const settlement = await settlementRepo.create({
        intent_id: 'intent-1',
        merchant_id: 'merchant-1',
        amount: 980,
        asset: 'USDC',
        chain: 'base',
        destination_address: '0xMerchantSettlementAddress',
      });

      const result = await settlementService.getSettlement(settlement.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(settlement.id);
    });

    it('should return null for non-existent settlement', async () => {
      const result = await settlementService.getSettlement('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getPendingSettlements', () => {
    it('should return pending settlements', async () => {
      await settlementRepo.create({
        intent_id: 'intent-1',
        merchant_id: 'merchant-1',
        amount: 980,
        asset: 'USDC',
        chain: 'base',
        destination_address: '0xMerchantSettlementAddress',
      });

      const result = await settlementService.getPendingSettlements();
      expect(result.length).toBe(1);
      expect(result[0]!.status).toBe('PENDING');
    });
  });
});
