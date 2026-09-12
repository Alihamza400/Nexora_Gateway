import {
  PaymentIntent,
  NewPaymentIntent,
  IntentState,
  Quote,
  VALID_TRANSITIONS,
  IntentEvent,
} from '@crypto-gateway/shared';
import {
  isValidTransition,
  ValidationError,
  IntentNotFoundError,
  QuoteExpiredError,
} from '@crypto-gateway/shared';
import { PaymentIntentRepository } from './payment-intent.repository.js';
import { MerchantConfigService } from './merchant-config.service.js';
import { WebhookDeliveryService } from './webhook-delivery.service.js';

/**
 * Payment Intent Service
 *
 * System of record for every payment attempt in the crypto gateway.
 * Manages the full lifecycle from creation through settlement.
 *
 * Flow:
 *   CREATED → QUOTED → AWAITING_PAYMENT → DETECTED → CONFIRMING
 *   → ROUTING → SETTLING → SETTLED
 */
export class PaymentIntentService {
  constructor(
    private readonly repository: PaymentIntentRepository,
    private readonly merchantService: MerchantConfigService,
    private readonly webhookService: WebhookDeliveryService,
  ) {}

  /**
   * Create a new payment intent.
   * Validates merchant exists and assets are accepted.
   */
  async createIntent(data: NewPaymentIntent): Promise<PaymentIntent> {
    // Validate merchant exists
    const merchant = await this.merchantService.getById(data.merchant_id);
    if (!merchant) {
      throw new ValidationError('Merchant not found', { merchant_id: data.merchant_id });
    }

    // Validate target asset is accepted by merchant
    if (!merchant.accepted_assets.includes(data.target_asset)) {
      throw new ValidationError('Target asset not accepted by merchant', {
        target_asset: data.target_asset,
        accepted_assets: merchant.accepted_assets,
      });
    }

    // Validate target chain is accepted by merchant
    if (!merchant.accepted_chains.includes(data.target_chain)) {
      throw new ValidationError('Target chain not accepted by merchant', {
        target_chain: data.target_chain,
        accepted_chains: merchant.accepted_chains,
      });
    }

    // Validate amount is within bounds
    if (data.target_amount <= 0) {
      throw new ValidationError('Target amount must be positive', {
        target_amount: data.target_amount,
      });
    }

    if (data.target_amount > 1_000_000) {
      throw new ValidationError('Target amount exceeds maximum', {
        target_amount: data.target_amount,
      });
    }

    // Create intent
    const intent = await this.repository.create(data);

    // Emit webhook
    await this.webhookService.deliverWebhook(intent, 'INTENT_CREATED', {
      merchant_id: intent.merchant_id,
      order_ref: intent.order_ref,
      target_amount: intent.target_amount,
      target_asset: intent.target_asset,
      target_chain: intent.target_chain,
    });

    return intent;
  }

  /**
   * Generate a quote for an intent.
   * Sets the exchange rate and expiration time.
   */
  async generateQuote(
    intentId: string,
    rate: number,
    depositAddress: string,
    depositAsset: string,
    depositChain: string,
  ): Promise<{ intent: PaymentIntent; quote: Quote }> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    // Validate we can transition to QUOTED
    if (!isValidTransition(VALID_TRANSITIONS, intent.state, 'QUOTED')) {
      throw new ValidationError(`Cannot generate quote in state: ${intent.state}`);
    }

    // Get merchant's quote TTL
    const merchant = await this.merchantService.getById(intent.merchant_id);
    const ttlSeconds = merchant?.quote_ttl_seconds || 300;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Update intent with quote data. The deposit details are persisted on the
    // intent, not just emitted into the event payload, so the deposit watcher can
    // resolve an incoming transfer to this intent by index lookup.
    await this.repository.updateQuote(intentId, rate, expiresAt, {
      address: depositAddress,
      asset: depositAsset,
      chain: depositChain,
    });

    // Transition to QUOTED state
    const transitionedIntent = await this.repository.transition(intentId, 'QUOTE_GENERATED', {
      rate,
      deposit_address: depositAddress,
      deposit_asset: depositAsset,
      deposit_chain: depositChain,
      expires_at: expiresAt.toISOString(),
    });

    const quote: Quote = {
      rate,
      expires_at: expiresAt,
      deposit_address: depositAddress,
      deposit_asset: depositAsset,
      deposit_chain: depositChain,
    };

    // Emit webhook
    await this.webhookService.deliverWebhook(transitionedIntent, 'QUOTE_GENERATED', {
      quote,
    });

    return { intent: transitionedIntent, quote };
  }

  /**
   * Transition intent to AWAITING_PAYMENT after customer accepts quote.
   */
  async awaitPayment(intentId: string): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    if (!isValidTransition(VALID_TRANSITIONS, intent.state, 'AWAITING_PAYMENT')) {
      throw new ValidationError(`Cannot await payment in state: ${intent.state}`);
    }

    const updated = await this.repository.transition(intentId, 'PAYMENT_AWAITED', {
      deposit_address: intent.deposit_address,
      deposit_asset: intent.deposit_asset,
      deposit_chain: intent.deposit_chain,
      quote_expires_at: intent.quote_expires_at?.toISOString() ?? null,
      awaited_at: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Record an observed on-chain deposit against an intent.
   *
   * This is the entry point for the deposit watcher. It encapsulates the state
   * rules so the watcher does not have to know them:
   *
   *   QUOTED          → AWAITING_PAYMENT → DETECTED
   *   AWAITING_PAYMENT→ DETECTED
   *   UNDERPAID       → DETECTED (a top-up that completes the payment)
   *
   * Safe to call more than once for the same transfer. A reclaimed job can run
   * twice, so a duplicate must be a no-op rather than a second transition.
   */
  async recordDeposit(
    intentId: string,
    txHash: string,
    amount: number,
    sourceChain: string,
    sourceAsset: string,
  ): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    // Already processed, or in a state that does not accept a deposit. Returning
    // the current intent makes a duplicate delivery a no-op.
    const acceptsDeposit: IntentState[] = ['QUOTED', 'AWAITING_PAYMENT', 'UNDERPAID'];
    if (!acceptsDeposit.includes(intent.state)) {
      return intent;
    }

    // A customer can pay before the client polls for quote acceptance, so the
    // transition through AWAITING_PAYMENT may still be outstanding.
    if (intent.state === 'QUOTED') {
      await this.awaitPayment(intentId);
    }

    try {
      return await this.detectDeposit(intentId, txHash, amount, sourceChain, sourceAsset);
    } catch (error) {
      // A payment that arrives after the quote expired is a recovery case, not a
      // failed job. detectDeposit has already transitioned the intent to EXPIRED
      // and emitted QUOTE_EXPIRED, so retrying would only loop.
      if (error instanceof QuoteExpiredError) {
        const expired = await this.repository.findById(intentId);
        if (expired) return expired;
      }
      throw error;
    }
  }

  /**
   * Detect a deposit for an intent.
   */
  async detectDeposit(
    intentId: string,
    txHash: string,
    amount: number,
    sourceChain: string,
    sourceAsset: string,
  ): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    // Check if quote is expired
    if (intent.quote_expires_at && intent.quote_expires_at < new Date()) {
      await this.repository.transition(intentId, 'QUOTE_EXPIRED', {
        expired_at: new Date().toISOString(),
      });
      throw new QuoteExpiredError(intentId);
    }

    // Detect underpayment or overpayment
    const expectedAmount = intent.target_amount;
    const tolerance = 0.01; // 1% tolerance

    if (amount < expectedAmount * (1 - tolerance)) {
      const updated = await this.repository.transition(intentId, 'UNDERPAYMENT_DETECTED', {
        expected: expectedAmount,
        received: amount,
        shortfall: expectedAmount - amount,
        tx_hash: txHash,
        source_chain: sourceChain,
        source_asset: sourceAsset,
      });

      await this.webhookService.deliverWebhook(updated, 'UNDERPAYMENT_DETECTED', {
        expected: expectedAmount,
        received: amount,
        shortfall: expectedAmount - amount,
        tx_hash: txHash,
      });

      return updated;
    }

    if (amount > expectedAmount * (1 + tolerance)) {
      const updated = await this.repository.transition(intentId, 'OVERPAYMENT_DETECTED', {
        expected: expectedAmount,
        received: amount,
        excess: amount - expectedAmount,
        tx_hash: txHash,
        source_chain: sourceChain,
        source_asset: sourceAsset,
      });

      await this.webhookService.deliverWebhook(updated, 'OVERPAYMENT_DETECTED', {
        expected: expectedAmount,
        received: amount,
        excess: amount - expectedAmount,
        tx_hash: txHash,
      });

      return updated;
    }

    // Normal payment detected
    const updated = await this.repository.transition(intentId, 'DEPOSIT_DETECTED', {
      tx_hash: txHash,
      amount,
      source_chain: sourceChain,
      source_asset: sourceAsset,
      detected_at: new Date().toISOString(),
    });

    await this.webhookService.deliverWebhook(updated, 'DEPOSIT_DETECTED', {
      tx_hash: txHash,
      amount,
      source_chain: sourceChain,
      source_asset: sourceAsset,
    });

    return updated;
  }

  /**
   * Confirm a deposit after sufficient block confirmations.
   */
  async confirmDeposit(intentId: string, confirmationCount: number): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    const updated = await this.repository.transition(intentId, 'CONFIRMATION_RECEIVED', {
      confirmation_count: confirmationCount,
      confirmed_at: new Date().toISOString(),
    });

    await this.webhookService.deliverWebhook(updated, 'CONFIRMATION_RECEIVED', {
      confirmation_count: confirmationCount,
    });

    return updated;
  }

  /**
   * Select a route for the payment.
   */
  async selectRoute(
    intentId: string,
    routeId: string,
    provider: string,
    estimatedFee: number,
    estimatedTime: number,
  ): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    const updated = await this.repository.transition(intentId, 'ROUTE_SELECTED', {
      route_id: routeId,
      provider,
      estimated_fee: estimatedFee,
      estimated_time: estimatedTime,
      selected_at: new Date().toISOString(),
    });

    await this.webhookService.deliverWebhook(updated, 'ROUTE_SELECTED', {
      route_id: routeId,
      provider,
      estimated_fee: estimatedFee,
      estimated_time: estimatedTime,
    });

    return updated;
  }

  /**
   * Initiate settlement to the merchant.
   */
  async initiateSettlement(intentId: string, settlementAmount: number): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    const updated = await this.repository.transition(intentId, 'SETTLEMENT_INITIATED', {
      settlement_amount: settlementAmount,
      initiated_at: new Date().toISOString(),
    });

    await this.webhookService.deliverWebhook(updated, 'SETTLEMENT_INITIATED', {
      settlement_amount: settlementAmount,
    });

    return updated;
  }

  /**
   * Confirm settlement completion.
   */
  async confirmSettlement(intentId: string, txHash: string): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    const updated = await this.repository.transition(intentId, 'SETTLEMENT_CONFIRMED', {
      settlement_tx_hash: txHash,
      settled_at: new Date().toISOString(),
    });

    await this.webhookService.deliverWebhook(updated, 'SETTLEMENT_CONFIRMED', {
      settlement_tx_hash: txHash,
    });

    return updated;
  }

  /**
   * Mark an intent as failed.
   */
  async failIntent(intentId: string, reason: string, error?: string): Promise<PaymentIntent> {
    const intent = await this.repository.findById(intentId);
    if (!intent) {
      throw new IntentNotFoundError(intentId);
    }

    const updated = await this.repository.transition(intentId, 'FAILED', {
      reason,
      error,
      failed_at: new Date().toISOString(),
    });

    await this.webhookService.deliverWebhook(updated, 'FAILED', {
      reason,
      error,
    });

    return updated;
  }

  /**
   * Get intent by ID.
   */
  async getIntent(id: string): Promise<PaymentIntent | null> {
    return this.repository.findById(id);
  }

  /**
   * Get intent with full event history.
   */
  async getIntentWithEvents(
    id: string,
  ): Promise<{ intent: PaymentIntent; events: IntentEvent[] } | null> {
    const intent = await this.repository.findById(id);
    if (!intent) return null;

    const events = await this.repository.getEvents(id);
    return { intent, events };
  }

  /**
   * Get intents for a merchant.
   */
  async getMerchantIntents(
    merchantId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<PaymentIntent[]> {
    return this.repository.findByMerchantId(merchantId, options.limit, options.offset);
  }

  /**
   * Get intent counts by state for a merchant.
   */
  async getMerchantStats(merchantId: string): Promise<Record<IntentState, number>> {
    return this.repository.getCountByState(merchantId);
  }

  /**
   * Check and expire any intents with expired quotes.
   */
  async processExpiredQuotes(): Promise<number> {
    const expired = await this.repository.findExpiredIntents();

    for (const intent of expired) {
      try {
        await this.repository.transition(intent.id, 'QUOTE_EXPIRED', {
          expired_at: new Date().toISOString(),
        });

        await this.webhookService.deliverWebhook(intent, 'QUOTE_EXPIRED', {
          intent_id: intent.id,
        });
      } catch (error) {
        console.error(`Failed to expire intent ${intent.id}:`, error);
      }
    }

    return expired.length;
  }
}
