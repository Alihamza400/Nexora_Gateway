import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentIntentService } from './payment-intent.service.js';
import { PaymentIntentRepository } from './payment-intent.repository.js';
import { MerchantConfigService } from './merchant-config.service.js';
import { WebhookDeliveryService } from './webhook-delivery.service.js';
import { PaymentIntent, MerchantConfig, QuoteExpiredError } from '@crypto-gateway/shared';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMerchant: MerchantConfig = {
  id: 'merchant-001',
  name: 'Test Shop',
  settlement_asset: 'USDC',
  settlement_chain: '1',
  settlement_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  accepted_chains: ['1', '8453', '42161'],
  accepted_assets: ['USDC', 'USDT', 'ETH'],
  fee_percentage: 1.0,
  kyc_threshold: 10000,
  quote_ttl_seconds: 300,
  webhook_url: 'https://webhook.example.com/test',
  compliance_status: 'COMPLIANT',
  created_at: new Date(),
  updated_at: new Date(),
};

const mockIntent: PaymentIntent = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  merchant_id: 'merchant-001',
  order_ref: 'order-123',
  target_amount: 100,
  target_asset: 'USDC',
  target_chain: '1',
  accepted_assets: ['USDC', 'USDT'],
  quoted_rate: null,
  quote_expires_at: null,
  deposit_address: null,
  deposit_asset: null,
  deposit_chain: null,
  state: 'CREATED',
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
};

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('PaymentIntentService', () => {
  let service: PaymentIntentService;
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;
  let mockMerchantService: Record<string, ReturnType<typeof vi.fn>>;
  let mockWebhookService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockRepo = {
      create: vi.fn().mockResolvedValue(mockIntent),
      transition: vi.fn().mockImplementation((_id, _event, _payload) => {
        return Promise.resolve({ ...mockIntent, state: 'QUOTED', version: 2 });
      }),
      findById: vi.fn().mockResolvedValue(mockIntent),
      findByMerchantId: vi.fn().mockResolvedValue([mockIntent]),
      findByOrderRef: vi.fn().mockResolvedValue(mockIntent),
      findExpiredIntents: vi.fn().mockResolvedValue([]),
      getEvents: vi.fn().mockResolvedValue([]),
      getCountByState: vi.fn().mockResolvedValue({ CREATED: 1 }),
      updateQuote: vi.fn().mockImplementation((_id: string, rate: number, expiresAt: Date) => {
        return Promise.resolve({
          ...mockIntent,
          quoted_rate: rate,
          quote_expires_at: expiresAt,
        });
      }),
    };

    mockMerchantService = {
      getById: vi.fn().mockResolvedValue(mockMerchant),
      getByApiKeyHash: vi.fn().mockResolvedValue(mockMerchant),
      getAll: vi.fn().mockResolvedValue([mockMerchant]),
      isCompliant: vi.fn().mockResolvedValue(true),
    };

    mockWebhookService = {
      deliverWebhook: vi.fn().mockResolvedValue(undefined),
      processRetries: vi.fn().mockResolvedValue(0),
      getStats: vi.fn().mockResolvedValue({ pending: 0, delivered: 0, failed: 0 }),
    };

    service = new PaymentIntentService(
      mockRepo as PaymentIntentRepository,
      mockMerchantService as MerchantConfigService,
      mockWebhookService as WebhookDeliveryService,
    );
  });

  // ─── createIntent ──────────────────────────────────────────────────────────

  describe('createIntent', () => {
    it('should create a valid payment intent', async () => {
      const result = await service.createIntent({
        merchant_id: 'merchant-001',
        order_ref: 'order-123',
        target_amount: 100,
        target_asset: 'USDC',
        target_chain: '1',
        accepted_assets: ['USDC', 'USDT'],
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(mockIntent.id);
      expect(result.state).toBe('CREATED');
      expect(mockRepo.create).toHaveBeenCalledOnce();
      expect(mockWebhookService.deliverWebhook).toHaveBeenCalledOnce();
    });

    it('should throw error if merchant not found', async () => {
      mockMerchantService.getById.mockResolvedValue(null);

      await expect(
        service.createIntent({
          merchant_id: 'nonexistent',
          order_ref: 'order-123',
          target_amount: 100,
          target_asset: 'USDC',
          target_chain: '1',
          accepted_assets: ['USDC'],
        }),
      ).rejects.toThrow('Merchant not found');
    });

    it('should throw error if target asset not accepted', async () => {
      await expect(
        service.createIntent({
          merchant_id: 'merchant-001',
          order_ref: 'order-123',
          target_amount: 100,
          target_asset: 'BTC', // Not in accepted_assets
          target_chain: '1',
          accepted_assets: ['USDC'],
        }),
      ).rejects.toThrow('Target asset not accepted by merchant');
    });

    it('should throw error if target chain not accepted', async () => {
      await expect(
        service.createIntent({
          merchant_id: 'merchant-001',
          order_ref: 'order-123',
          target_amount: 100,
          target_asset: 'USDC',
          target_chain: '56', // BSC - not in accepted_chains
          accepted_assets: ['USDC'],
        }),
      ).rejects.toThrow('Target chain not accepted by merchant');
    });

    it('should throw error if amount is zero or negative', async () => {
      await expect(
        service.createIntent({
          merchant_id: 'merchant-001',
          order_ref: 'order-123',
          target_amount: 0,
          target_asset: 'USDC',
          target_chain: '1',
          accepted_assets: ['USDC'],
        }),
      ).rejects.toThrow('Target amount must be positive');
    });

    it('should throw error if amount exceeds maximum', async () => {
      await expect(
        service.createIntent({
          merchant_id: 'merchant-001',
          order_ref: 'order-123',
          target_amount: 2_000_000,
          target_asset: 'USDC',
          target_chain: '1',
          accepted_assets: ['USDC'],
        }),
      ).rejects.toThrow('Target amount exceeds maximum');
    });
  });

  // ─── generateQuote ─────────────────────────────────────────────────────────

  describe('generateQuote', () => {
    it('should generate a quote for an intent', async () => {
      mockRepo.findById.mockResolvedValue(mockIntent);

      const result = await service.generateQuote(
        mockIntent.id,
        1.0,
        '0xDepositAddress',
        'USDC',
        '1',
      );

      expect(result).toBeDefined();
      expect(result.quote).toBeDefined();
      expect(result.quote.rate).toBe(1.0);
      expect(result.quote.deposit_address).toBe('0xDepositAddress');
      expect(mockRepo.updateQuote).toHaveBeenCalled();
      expect(mockRepo.transition).toHaveBeenCalledWith(
        mockIntent.id,
        'QUOTE_GENERATED',
        expect.any(Object),
      );
    });

    it('should throw error if intent not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.generateQuote('nonexistent', 1.0, '0xAddr', 'USDC', '1'),
      ).rejects.toThrow('Payment intent not found');
    });
  });

  // ─── detectDeposit ─────────────────────────────────────────────────────────

  describe('detectDeposit', () => {
    it('should detect a normal deposit', async () => {
      const quotedIntent = { ...mockIntent, state: 'AWAITING_PAYMENT' };
      mockRepo.findById.mockResolvedValue(quotedIntent);

      const result = await service.detectDeposit(mockIntent.id, '0xtxhash', 100, '1', 'USDC');

      expect(result).toBeDefined();
      expect(mockRepo.transition).toHaveBeenCalledWith(
        mockIntent.id,
        'DEPOSIT_DETECTED',
        expect.objectContaining({
          tx_hash: '0xtxhash',
          amount: 100,
        }),
      );
    });

    it('should detect underpayment', async () => {
      const quotedIntent = { ...mockIntent, state: 'AWAITING_PAYMENT' };
      mockRepo.findById.mockResolvedValue(quotedIntent);

      await service.detectDeposit(mockIntent.id, '0xtxhash', 50, '1', 'USDC');

      expect(mockRepo.transition).toHaveBeenCalledWith(
        mockIntent.id,
        'UNDERPAYMENT_DETECTED',
        expect.objectContaining({
          expected: 100,
          received: 50,
          shortfall: 50,
        }),
      );
    });

    it('should detect overpayment', async () => {
      const quotedIntent = { ...mockIntent, state: 'AWAITING_PAYMENT' };
      mockRepo.findById.mockResolvedValue(quotedIntent);

      await service.detectDeposit(mockIntent.id, '0xtxhash', 150, '1', 'USDC');

      expect(mockRepo.transition).toHaveBeenCalledWith(
        mockIntent.id,
        'OVERPAYMENT_DETECTED',
        expect.objectContaining({
          expected: 100,
          received: 150,
          excess: 50,
        }),
      );
    });

    it('should throw error if intent not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.detectDeposit('nonexistent', '0xtxhash', 100, '1', 'USDC'),
      ).rejects.toThrow('Payment intent not found');
    });
  });

  // ─── failIntent ────────────────────────────────────────────────────────────

  describe('failIntent', () => {
    it('should mark an intent as failed', async () => {
      const result = await service.failIntent(mockIntent.id, 'test failure');

      expect(result).toBeDefined();
      expect(mockRepo.transition).toHaveBeenCalledWith(
        mockIntent.id,
        'FAILED',
        expect.objectContaining({ reason: 'test failure' }),
      );
      expect(mockWebhookService.deliverWebhook).toHaveBeenCalled();
    });
  });

  // ─── processExpiredQuotes ──────────────────────────────────────────────────

  describe('processExpiredQuotes', () => {
    it('should process expired quotes', async () => {
      mockRepo.findExpiredIntents.mockResolvedValue([
        { ...mockIntent, state: 'QUOTED' },
        { ...mockIntent, id: 'another-id', state: 'AWAITING_PAYMENT' },
      ]);

      const count = await service.processExpiredQuotes();

      expect(count).toBe(2);
      expect(mockRepo.transition).toHaveBeenCalledTimes(2);
    });

    it('should return 0 if no expired quotes', async () => {
      mockRepo.findExpiredIntents.mockResolvedValue([]);

      const count = await service.processExpiredQuotes();

      expect(count).toBe(0);
      expect(mockRepo.transition).not.toHaveBeenCalled();
    });
  });

  // ─── getIntent ─────────────────────────────────────────────────────────────

  describe('getIntent', () => {
    it('should return intent if found', async () => {
      const result = await service.getIntent(mockIntent.id);
      expect(result).toEqual(mockIntent);
    });

    it('should return null if not found', async () => {
      mockRepo.findById.mockResolvedValue(null);
      const result = await service.getIntent('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── getIntentWithEvents ───────────────────────────────────────────────────

  describe('getIntentWithEvents', () => {
    it('should return intent with events', async () => {
      mockRepo.getEvents.mockResolvedValue([
        {
          id: 'event-1',
          intent_id: mockIntent.id,
          event_type: 'INTENT_CREATED',
          payload: {},
          version: 1,
          created_at: new Date(),
        },
      ]);

      const result = await service.getIntentWithEvents(mockIntent.id);

      expect(result).toBeDefined();
      expect(result?.intent).toEqual(mockIntent);
      expect(result?.events).toHaveLength(1);
    });

    it('should return null if intent not found', async () => {
      mockRepo.findById.mockResolvedValue(null);
      const result = await service.getIntentWithEvents('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── Deposit lifecycle ─────────────────────────────────────────────────────
  //
  // Regression coverage for a defect that made the deposit path unreachable:
  // no EventType mapped to AWAITING_PAYMENT, so awaitPayment() attempted
  // QUOTED → QUOTED and threw, which in turn made DEPOSIT_DETECTED unreachable
  // because the state machine only permits AWAITING_PAYMENT → DETECTED.

  describe('awaitPayment', () => {
    it('emits PAYMENT_AWAITED so the intent reaches AWAITING_PAYMENT', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockIntent, state: 'QUOTED' });
      mockRepo.transition.mockResolvedValue({
        ...mockIntent,
        state: 'AWAITING_PAYMENT',
        version: 2,
      });

      const result = await service.awaitPayment(mockIntent.id);

      expect(mockRepo.transition).toHaveBeenCalledWith(
        mockIntent.id,
        'PAYMENT_AWAITED',
        expect.any(Object),
      );
      expect(result.state).toBe('AWAITING_PAYMENT');
    });

    it('refuses to await payment from a terminal state', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockIntent, state: 'SETTLED' });

      await expect(service.awaitPayment(mockIntent.id)).rejects.toThrow(
        /Cannot await payment in state: SETTLED/,
      );
      expect(mockRepo.transition).not.toHaveBeenCalled();
    });
  });

  describe('recordDeposit', () => {
    it('moves a QUOTED intent through AWAITING_PAYMENT to DETECTED', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockIntent, state: 'QUOTED' });
      mockRepo.transition
        .mockResolvedValueOnce({ ...mockIntent, state: 'AWAITING_PAYMENT', version: 2 })
        .mockResolvedValueOnce({ ...mockIntent, state: 'DETECTED', version: 3 });

      const result = await service.recordDeposit(mockIntent.id, '0xabc', 100, '1', 'USDC');

      expect(mockRepo.transition).toHaveBeenNthCalledWith(
        1,
        mockIntent.id,
        'PAYMENT_AWAITED',
        expect.any(Object),
      );
      expect(mockRepo.transition).toHaveBeenNthCalledWith(
        2,
        mockIntent.id,
        'DEPOSIT_DETECTED',
        expect.any(Object),
      );
      expect(result.state).toBe('DETECTED');
    });

    it('is a no-op for a duplicate delivery of an already-detected intent', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockIntent, state: 'DETECTED' });

      const result = await service.recordDeposit(mockIntent.id, '0xabc', 100, '1', 'USDC');

      // A reclaimed job can run twice; the second run must not transition again.
      expect(mockRepo.transition).not.toHaveBeenCalled();
      expect(result.state).toBe('DETECTED');
    });

    it('treats a late payment on an expired quote as a recovery case, not a failure', async () => {
      const expired = { ...mockIntent, state: 'EXPIRED' } as PaymentIntent;
      // First lookup: the intent still accepts a deposit. Second lookup (in the
      // catch block): detectDeposit has already moved it to EXPIRED.
      mockRepo.findById
        .mockResolvedValueOnce({ ...mockIntent, state: 'AWAITING_PAYMENT' })
        .mockResolvedValueOnce(expired);
      mockRepo.transition.mockResolvedValue(expired);
      const detectSpy = vi
        .spyOn(service, 'detectDeposit')
        .mockRejectedValue(new QuoteExpiredError(mockIntent.id));

      const result = await service.recordDeposit(mockIntent.id, '0xabc', 100, '1', 'USDC');

      expect(result.state).toBe('EXPIRED');
      expect(mockWebhookService.deliverWebhook).not.toHaveBeenCalled();
      detectSpy.mockRestore();
    });

    it('throws when the intent does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.recordDeposit('missing', '0xabc', 100, '1', 'USDC')).rejects.toThrow(
        /missing/,
      );
    });
  });
});
