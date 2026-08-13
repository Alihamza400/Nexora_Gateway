import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { intentRoutes } from './intents.js';
import type { PaymentIntent, IntentEvent, MerchantConfig } from '@crypto-gateway/shared';

// ─── Mock Services ──────────────────────────────────────────────────────

const mockMerchant: MerchantConfig = {
  id: 'merchant-001',
  name: 'Test Shop',
  settlement_asset: 'USDC',
  settlement_chain: '1',
  settlement_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  accepted_chains: ['1', '8453'],
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
  state: 'CREATED',
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockEvent: IntentEvent = {
  id: 'event-1',
  intent_id: mockIntent.id,
  event_type: 'INTENT_CREATED',
  payload: {},
  version: 1,
  created_at: new Date(),
};

function createMockIntentService() {
  return {
    createIntent: vi.fn().mockResolvedValue(mockIntent),
    getIntent: vi.fn().mockResolvedValue(mockIntent),
    getIntentWithEvents: vi.fn().mockResolvedValue({ intent: mockIntent, events: [mockEvent] }),
    getMerchantIntents: vi.fn().mockResolvedValue([mockIntent]),
    generateQuote: vi.fn().mockResolvedValue({
      intent: { ...mockIntent, state: 'QUOTED' },
      quote: {
        rate: 1.0,
        expires_at: new Date(Date.now() + 300000),
        deposit_address: '0xDepositAddress',
        deposit_asset: 'USDC',
        deposit_chain: '1',
      },
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Intent Routes', () => {
  let app: FastifyInstance;
  let mockService: ReturnType<typeof createMockIntentService>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    mockService = createMockIntentService();
    await intentRoutes(app, mockService as any);
    await app.ready();
  });

  // ─── POST /api/v1/intents ────────────────────────────────────────────

  describe('POST /api/v1/intents', () => {
    it('creates a new payment intent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/intents',
        payload: {
          merchant_id: 'merchant-001',
          order_ref: 'order-123',
          target_amount: 100,
          target_asset: 'USDC',
          target_chain: '1',
          accepted_assets: ['USDC', 'USDT'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.intent_id).toBe(mockIntent.id);
      expect(body.state).toBe('CREATED');
      expect(body.created_at).toBeDefined();
    });

    it('returns 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/intents',
        payload: {
          merchant_id: 'merchant-001',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for empty accepted_assets', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/intents',
        payload: {
          merchant_id: 'merchant-001',
          order_ref: 'order-123',
          target_amount: 100,
          target_asset: 'USDC',
          target_chain: '1',
          accepted_assets: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls createIntent with correct payload', async () => {
      const payload = {
        merchant_id: 'merchant-001',
        order_ref: 'order-123',
        target_amount: 100,
        target_asset: 'USDC',
        target_chain: '1',
        accepted_assets: ['USDC', 'USDT'],
      };

      await app.inject({
        method: 'POST',
        url: '/api/v1/intents',
        payload,
      });

      expect(mockService.createIntent).toHaveBeenCalledWith(payload);
    });
  });

  // ─── GET /api/v1/intents/:id ────────────────────────────────────────

  describe('GET /api/v1/intents/:id', () => {
    it('returns intent details', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/intents/${mockIntent.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.intent_id).toBe(mockIntent.id);
      expect(body.merchant_id).toBe(mockIntent.merchant_id);
      expect(body.state).toBe(mockIntent.state);
      expect(body.events).toBeDefined();
      expect(body.events.length).toBe(1);
    });

    it('returns 404 for non-existent intent', async () => {
      mockService.getIntentWithEvents.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/intents/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('INTENT_NOT_FOUND');
    });
  });

  // ─── GET /api/v1/intents ────────────────────────────────────────────

  describe('GET /api/v1/intents', () => {
    it('returns intents for merchant', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/intents?merchant_id=merchant-001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.intents).toBeDefined();
      expect(body.intents.length).toBe(1);
    });

    it('returns 400 without merchant_id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/intents',
      });

      expect(response.statusCode).toBe(400);
    });

    it('passes limit and offset to service', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/v1/intents?merchant_id=merchant-001&limit=10&offset=5',
      });

      expect(mockService.getMerchantIntents).toHaveBeenCalledWith('merchant-001', {
        limit: 10,
        offset: 5,
      });
    });
  });

  // ─── POST /api/v1/intents/:id/quote ─────────────────────────────────

  describe('POST /api/v1/intents/:id/quote', () => {
    it('generates a quote', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/intents/${mockIntent.id}/quote`,
        payload: {
          rate: 1.0,
          deposit_address: '0xDepositAddress',
          deposit_asset: 'USDC',
          deposit_chain: '1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.quote).toBeDefined();
      expect(body.quote.rate).toBe(1.0);
      expect(body.quote.deposit_address).toBe('0xDepositAddress');
    });

    it('returns 400 for missing quote fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/intents/${mockIntent.id}/quote`,
        payload: {
          rate: 1.0,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for non-existent intent', async () => {
      mockService.generateQuote.mockRejectedValue(new Error('Payment intent not found: nonexistent'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/intents/nonexistent/quote',
        payload: {
          rate: 1.0,
          deposit_address: '0xDepositAddress',
          deposit_asset: 'USDC',
          deposit_chain: '1',
        },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
