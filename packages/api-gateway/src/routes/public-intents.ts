import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PaymentIntentService, MerchantConfigService } from '@crypto-gateway/payment-intent';
import { ValidationError } from '@crypto-gateway/shared';

/**
 * Public Payment Intent Routes
 *
 * No authentication required. Customers create intents directly by entering
 * an amount. The merchant is resolved from the merchant_id query param or
 * defaults to the first active merchant.
 */

export function publicIntentRoutes(
  app: FastifyInstance,
  intentService: PaymentIntentService,
  merchantService: MerchantConfigService,
): void {
  /**
   * GET /api/v1/public/merchants - List active merchants (for selection)
   */
  app.get('/api/v1/public/merchants', async (_request: FastifyRequest, reply: FastifyReply) => {
    const merchants = await merchantService.getAll();
    return reply.send({
      merchants: merchants
        .filter((m) => m.compliance_status === 'COMPLIANT' || m.compliance_status === 'PENDING')
        .map((m) => ({
          id: m.id,
          name: m.name,
          accepted_chains: m.accepted_chains,
          accepted_assets: m.accepted_assets,
          settlement_asset: m.settlement_asset,
        })),
    });
  });

  /**
   * POST /api/v1/public/intents - Create a payment intent (no auth)
   *
   * @example POST /api/v1/public/intents?merchant_id=xxx
   * {
   *   "order_ref": "Customer Order #123",
   *   "target_amount": 50,
   *   "target_asset": "USDC",
   *   "target_chain": "84532",
   *   "accepted_assets": ["ETH", "USDC", "USDT"]
   * }
   */
  app.post('/api/v1/public/intents', async (request: FastifyRequest, reply: FastifyReply) => {
    const { merchant_id } = request.query as { merchant_id?: string };
    const body = request.body as {
      order_ref?: string;
      target_amount: number;
      target_asset: string;
      target_chain: string;
      accepted_assets?: string[];
    };

    // Resolve merchant
    let resolvedMerchantId = merchant_id;
    if (!resolvedMerchantId) {
      const merchants = await merchantService.getAll();
      const active = merchants.find(
        (m) => m.compliance_status === 'COMPLIANT' || m.compliance_status === 'PENDING',
      );
      if (!active) {
        return reply.status(400).send({
          error: {
            code: 'NO_MERCHANTS',
            message: 'No active merchants available',
          },
        });
      }
      resolvedMerchantId = active.id;
    }

    if (!body.target_amount || !body.target_asset || !body.target_chain) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields: target_amount, target_asset, target_chain',
        },
      });
    }

    if (body.target_amount <= 0) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'target_amount must be greater than 0',
        },
      });
    }

    try {
      const intent = await intentService.createIntent({
        merchant_id: resolvedMerchantId,
        order_ref: body.order_ref || `ORDER-${Date.now()}`,
        target_amount: body.target_amount,
        target_asset: body.target_asset,
        target_chain: body.target_chain,
        accepted_assets: body.accepted_assets || [body.target_asset],
      });

      // Auto-generate quote so customer sees deposit details immediately
      const merchant = await merchantService.getById(resolvedMerchantId);
      const depositAddress =
        merchant?.settlement_address || '0x0000000000000000000000000000000000000000';
      const rate = 1.0;

      const quoted = await intentService.generateQuote(
        intent.id,
        rate,
        depositAddress,
        body.target_asset,
        body.target_chain,
      );

      return reply.status(201).send({
        intent_id: quoted.intent.id,
        state: quoted.intent.state,
        quote: {
          rate: quoted.quote.rate,
          deposit_address: quoted.quote.deposit_address,
          deposit_asset: quoted.quote.deposit_asset,
          deposit_chain: quoted.quote.deposit_chain,
          expires_at: quoted.quote.expires_at.toISOString(),
        },
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
}
