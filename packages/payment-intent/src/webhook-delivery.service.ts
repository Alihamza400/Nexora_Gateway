import { query } from '@crypto-gateway/db';
import { createHmac } from 'crypto';
import {
  PaymentIntent,
  EventType,
} from '@crypto-gateway/shared';
import { generateId } from '@crypto-gateway/shared';
import { MerchantConfigService } from './merchant-config.service.js';

/**
 * Retry delays in milliseconds (exponential backoff).
 * Attempt 1: Immediate
 * Attempt 2: 1 second
 * Attempt 3: 5 seconds
 * Attempt 4: 30 seconds
 * Attempt 5: 5 minutes
 */
const RETRY_DELAYS_MS = [0, 1000, 5000, 30000, 300_000];
const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 30_000;

/**
 * Webhook Delivery Service
 *
 * Handles idempotent webhook delivery to merchant endpoints.
 * Uses exponential backoff for retries.
 */
export class WebhookDeliveryService {
  constructor(private readonly merchantService: MerchantConfigService) {}

  /**
   * Deliver a webhook for an intent event.
   * Idempotent: uses intent_id + event_type as key.
   */
  async deliverWebhook(
    intent: PaymentIntent,
    eventType: EventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const merchant = await this.merchantService.getById(intent.merchant_id);
    if (!merchant?.webhook_url) {
      // No webhook URL configured, skip delivery
      return;
    }

    const signature = this.generateSignature(intent.id, eventType, data);

    // Upsert webhook delivery record (idempotent)
    const deliveryId = await this.upsertDelivery(
      intent.id,
      eventType,
      merchant.webhook_url,
      {
        intent_id: intent.id,
        event_type: eventType,
        state: intent.state,
        timestamp: new Date().toISOString(),
        data,
        signature,
      },
    );

    // Attempt delivery
    await this.attemptDelivery(deliveryId);
  }

  /**
   * Generate HMAC signature for webhook payload.
   */
  private generateSignature(
    intentId: string,
    eventType: EventType,
    data: Record<string, unknown>,
  ): string {
    const secret = process.env['WEBHOOK_SECRET'] || 'default-webhook-secret';
    const payload = JSON.stringify({ intent_id: intentId, event_type: eventType, data });
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Upsert a webhook delivery record.
   */
  private async upsertDelivery(
    intentId: string,
    eventType: EventType,
    webhookUrl: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO webhook_deliveries (id, intent_id, event_type, webhook_url, payload, status, attempt_count, created_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', 0, NOW())
       ON CONFLICT (intent_id, event_type) DO UPDATE
       SET payload = EXCLUDED.payload, webhook_url = EXCLUDED.webhook_url, updated_at = NOW()
       RETURNING id`,
      [generateId(), intentId, eventType, webhookUrl, JSON.stringify(payload)],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Failed to create webhook delivery');
    return row.id;
  }

  /**
   * Attempt to deliver a webhook with retry logic.
   */
  private async attemptDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.getDelivery(deliveryId);
    if (!delivery) return;

    const attempt = delivery.attempt_count + 1;
    const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;

    // Schedule retry if needed
    if (attempt > 1) {
      await this.updateDeliveryStatus(deliveryId, 'PENDING', attempt, new Date(Date.now() + delayMs));
      return; // Will be picked up by retry processor
    }

    // Attempt immediate delivery
    try {
      const response = await fetch(delivery.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': String(delivery.payload?.['signature'] ?? ''),
          'X-Webhook-Event': delivery.event_type,
          'X-Webhook-Delivery-Id': deliveryId,
        },
        body: JSON.stringify(delivery.payload),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      if (response.ok) {
        await this.updateDeliveryStatus(deliveryId, 'DELIVERED', attempt);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempt >= MAX_ATTEMPTS) {
        await this.updateDeliveryStatus(deliveryId, 'FAILED', attempt, undefined, errorMessage);
      } else {
        const retryDelay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        const nextRetryAt = new Date(Date.now() + retryDelay);
        await this.updateDeliveryStatus(deliveryId, 'PENDING', attempt, nextRetryAt, errorMessage);
      }
    }
  }

  /**
   * Process pending webhook retries.
   * Should be called periodically by a cron job or worker.
   */
  async processRetries(): Promise<number> {
    const result = await query<{ id: string }>(
      `SELECT id FROM webhook_deliveries
       WHERE status = 'PENDING'
       AND attempt_count < $1
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at
       LIMIT 100`,
      [MAX_ATTEMPTS],
    );

    let processed = 0;
    for (const row of result.rows) {
      await this.attemptDelivery(row.id);
      processed++;
    }

    return processed;
  }

  /**
   * Get a webhook delivery by ID.
   */
  private async getDelivery(id: string): Promise<any> {
    const result = await query(
      `SELECT * FROM webhook_deliveries WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    };
  }

  /**
   * Update webhook delivery status.
   */
  private async updateDeliveryStatus(
    id: string,
    status: string,
    attemptCount: number,
    nextRetryAt?: Date,
    lastError?: string,
  ): Promise<void> {
    await query(
      `UPDATE webhook_deliveries
       SET status = $1::VARCHAR, attempt_count = $2, last_attempt_at = NOW(),
           next_retry_at = $3, last_error = $4,
           completed_at = CASE WHEN $1 IN ('DELIVERED', 'FAILED') THEN NOW() ELSE completed_at END
       WHERE id = $5`,
      [status, attemptCount, nextRetryAt || null, lastError || null, id],
    );
  }

  /**
   * Get delivery statistics for monitoring.
   */
  async getStats(): Promise<{ pending: number; delivered: number; failed: number }> {
    const result = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count FROM webhook_deliveries GROUP BY status`,
    );

    const stats = { pending: 0, delivered: 0, failed: 0 };
    for (const row of result.rows) {
      const count = parseInt(row.count, 10);
      if (row.status === 'PENDING') stats.pending = count;
      else if (row.status === 'DELIVERED') stats.delivered = count;
      else if (row.status === 'FAILED') stats.failed = count;
    }

    return stats;
  }
}
