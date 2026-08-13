import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PaymentIntentService, NewPaymentIntent } from '@crypto-gateway/payment-intent';
import { ValidationError, IntentNotFoundError } from '@crypto-gateway/shared';

/**
 * Payment Intent API Routes
 *
 * POST /api/v1/intents          - Create a new payment intent
 * GET  /api/v1/intents/:id      - Get intent by ID
 * GET  /api/v1/intents           - List intents for merchant
 * POST /api/v1/intents/:id/quote - Generate a quote
 */

export async function intentRoutes(
  app: FastifyInstance,
  intentService: PaymentIntentService,
): Promise<void> {
  /**
   * Create a new payment intent.
   *
   * @example POST /api/v1/intents
   * {
   *   "merchant_id": "merchant-001",
   *   "order_ref": "order-123",
   *   "target_amount": 100,
   *   "target_asset": "USDC",
   *   "target_chain": "1",
   *   "accepted_assets": ["USDC", "USDT"]
   * }
   */
  app.post('/api/v1/intents', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as NewPaymentIntent;

    // Validate required fields
    if (!body.merchant_id || !body.order_ref || !body.target_amount || !body.target_asset || !body.target_chain) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields: merchant_id, order_ref, target_amount, target_asset, target_chain',
        },
      });
    }

    if (!body.accepted_assets || body.accepted_assets.length === 0) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'accepted_assets must be a non-empty array',
        },
      });
    }

    try {
      const intent = await intentService.createIntent(body);

      return reply.status(201).send({
        intent_id: intent.id,
        state: intent.state,
        created_at: intent.created_at.toISOString(),
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
      }
      throw error;
    }
  });

  /**
   * Get payment intent by ID.
   *
   * @example GET /api/v1/intents/550e8400-e29b-41d4-a716-446655440000
   */
  app.get('/api/v1/intents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const result = await intentService.getIntentWithEvents(id);

    if (!result) {
      return reply.status(404).send({
        error: {
          code: 'INTENT_NOT_FOUND',
          message: `Payment intent not found: ${id}`,
        },
      });
    }

    return reply.send({
      intent_id: result.intent.id,
      merchant_id: result.intent.merchant_id,
      order_ref: result.intent.order_ref,
      state: result.intent.state,
      target_amount: result.intent.target_amount,
      target_asset: result.intent.target_asset,
      target_chain: result.intent.target_chain,
      quoted_rate: result.intent.quoted_rate,
      quote_expires_at: result.intent.quote_expires_at?.toISOString() || null,
      created_at: result.intent.created_at.toISOString(),
      updated_at: result.intent.updated_at.toISOString(),
      events: result.events.map((e) => ({
        event_type: e.event_type,
        payload: e.payload,
        created_at: e.created_at.toISOString(),
      })),
    });
  });

  /**
   * List payment intents for a merchant.
   *
   * @example GET /api/v1/intents?merchant_id=merchant-001&limit=20&offset=0
   */
  app.get('/api/v1/intents', async (request: FastifyRequest, reply: FastifyReply) => {
    const { merchant_id, limit, offset } = request.query as {
      merchant_id?: string;
      limit?: string;
      offset?: string;
    };

    if (!merchant_id) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'merchant_id is required',
        },
      });
    }

    const intents = await intentService.getMerchantIntents(merchant_id, {
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return reply.send({
      intents: intents.map((i) => ({
        intent_id: i.id,
        order_ref: i.order_ref,
        state: i.state,
        target_amount: i.target_amount,
        target_asset: i.target_asset,
        created_at: i.created_at.toISOString(),
      })),
    });
  });

  /**
   * Generate a quote for an intent.
   *
   * @example POST /api/v1/intents/:id/quote
   * {
   *   "rate": 1.0,
   *   "deposit_address": "0x...",
   *   "deposit_asset": "USDC",
   *   "deposit_chain": "1"
   * }
   */
  app.post('/api/v1/intents/:id/quote', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      rate: number;
      deposit_address: string;
      deposit_asset: string;
      deposit_chain: string;
    };

    if (!body.rate || !body.deposit_address || !body.deposit_asset || !body.deposit_chain) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields: rate, deposit_address, deposit_asset, deposit_chain',
        },
      });
    }

    try {
      const result = await intentService.generateQuote(
        id,
        body.rate,
        body.deposit_address,
        body.deposit_asset,
        body.deposit_chain,
      );

      return reply.send({
        intent_id: result.intent.id,
        state: result.intent.state,
        quote: {
          rate: result.quote.rate,
          expires_at: result.quote.expires_at.toISOString(),
          deposit_address: result.quote.deposit_address,
          deposit_asset: result.quote.deposit_asset,
          deposit_chain: result.quote.deposit_chain,
        },
      });
    } catch (error) {
      if (error instanceof IntentNotFoundError) {
        return reply.status(404).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      if (error instanceof ValidationError) {
        return reply.status(400).send({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      throw error;
    }
  });
}
