import { query, transaction, type PoolClient } from '@crypto-gateway/db';
import {
  PaymentIntent,
  NewPaymentIntent,
  IntentState,
  IntentEvent,
  EventType,
  VALID_TRANSITIONS,
} from '@crypto-gateway/shared';
import { generateId, isValidTransition } from '@crypto-gateway/shared';

/**
 * Repository for payment intent persistence.
 *
 * Follows Single Writer Principle: all writes go through this repository.
 * Uses optimistic locking via the version field to prevent concurrent modifications.
 * Every state transition emits an event to the intent_events table.
 */
export class PaymentIntentRepository {
  /**
   * Create a new payment intent with initial state CREATED.
   */
  async create(data: NewPaymentIntent): Promise<PaymentIntent> {
    const id = generateId();
    const now = new Date();

    return transaction(async (client: PoolClient) => {
      // Insert intent
      const result = await client.query(
        `INSERT INTO payment_intents (id, merchant_id, order_ref, target_amount, target_asset, target_chain, accepted_assets, state, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'CREATED', 1, $8, $9)
         RETURNING *`,
        [
          id,
          data.merchant_id,
          data.order_ref,
          data.target_amount,
          data.target_asset,
          data.target_chain,
          data.accepted_assets,
          now,
          now,
        ],
      );

      const intent = this.mapRow(result.rows[0] as Record<string, unknown>);

      // Emit creation event
      await client.query(
        `INSERT INTO intent_events (id, intent_id, event_type, payload, version, created_at)
         VALUES ($1, $2, 'INTENT_CREATED', $3, 1, $4)`,
        [generateId(), id, JSON.stringify({ ...data }), now],
      );

      return intent;
    });
  }

  /**
   * Transition an intent to a new state with optimistic locking.
   * Emits an event for every transition.
   */
  async transition(
    id: string,
    eventType: EventType,
    payload: Record<string, unknown> = {},
  ): Promise<PaymentIntent> {
    return transaction(async (client: PoolClient) => {
      // Lock the row for update to prevent concurrent transitions
      const locked = await client.query(`SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE`, [
        id,
      ]);

      if (locked.rows.length === 0) {
        throw new Error(`Intent not found: ${id}`);
      }

      const current = this.mapRow(locked.rows[0] as Record<string, unknown>);
      const nextState = this.getExpectedNextState(eventType);
      const currentState = current.state;

      // Validate transition
      if (!isValidTransition(VALID_TRANSITIONS, currentState, nextState)) {
        throw new Error(`Invalid state transition from ${currentState} to ${nextState}`);
      }

      const newVersion = current.version + 1;
      const now = new Date();

      // Update intent state
      const result = await client.query(
        `UPDATE payment_intents
         SET state = $1, version = $2, updated_at = $3
         WHERE id = $4 AND version = $5
         RETURNING *`,
        [nextState, newVersion, now, id, current.version],
      );

      if (result.rows.length === 0) {
        throw new Error(`Concurrent modification detected for intent: ${id}`);
      }

      const updatedIntent = this.mapRow(result.rows[0] as Record<string, unknown>);

      // Emit event
      await client.query(
        `INSERT INTO intent_events (id, intent_id, event_type, payload, version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [generateId(), id, eventType, JSON.stringify(payload), newVersion, now],
      );

      return updatedIntent;
    });
  }

  /**
   * Find an intent by ID.
   */
  async findById(id: string): Promise<PaymentIntent | null> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM payment_intents WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Find all intents for a merchant.
   */
  async findByMerchantId(
    merchantId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<PaymentIntent[]> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM payment_intents WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Find an intent by merchant ID and order reference.
   */
  async findByOrderRef(orderRef: string): Promise<PaymentIntent | null> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM payment_intents WHERE order_ref = $1`,
      [orderRef],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Find intents in a given state, oldest first.
   *
   * Backs the worker's periodic sweeps (e.g. confirmation tracking). Limited so a
   * backlog cannot stall a sweep; the next sweep continues from the oldest
   * remaining row.
   */
  async findByState(state: IntentState, limit: number = 100): Promise<PaymentIntent[]> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM payment_intents
       WHERE state = $1
       ORDER BY updated_at ASC
       LIMIT $2`,
      [state, limit],
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Find all intents with expired quotes.
   */
  async findExpiredIntents(): Promise<PaymentIntent[]> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM payment_intents
       WHERE state IN ('QUOTED', 'AWAITING_PAYMENT')
       AND quote_expires_at IS NOT NULL
       AND quote_expires_at < NOW()`,
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Get all events for an intent (audit trail).
   */
  async getEvents(intentId: string): Promise<IntentEvent[]> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM intent_events WHERE intent_id = $1 ORDER BY created_at ASC`,
      [intentId],
    );
    return result.rows.map((row) => this.mapEventRow(row));
  }

  /**
   * Get intent count by state for a merchant.
   */
  async getCountByState(merchantId: string): Promise<Record<IntentState, number>> {
    const result = await query<{ state: IntentState; count: string }>(
      `SELECT state, COUNT(*) as count FROM payment_intents WHERE merchant_id = $1 GROUP BY state`,
      [merchantId],
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.state] = parseInt(row.count, 10);
    }
    return counts as Record<IntentState, number>;
  }

  /**
   * Update quote data on an intent.
   *
   * Deposit details are persisted here rather than only into the event payload so
   * the watcher can resolve an incoming transfer to an intent with one indexed
   * lookup (see migration 010).
   */
  async updateQuote(
    id: string,
    quotedRate: number,
    quoteExpiresAt: Date,
    deposit?: { address: string; asset: string; chain: string },
  ): Promise<PaymentIntent> {
    const result = await query<Record<string, unknown>>(
      `UPDATE payment_intents
       SET quoted_rate = $1,
           quote_expires_at = $2,
           deposit_address = COALESCE($3, deposit_address),
           deposit_asset = COALESCE($4, deposit_asset),
           deposit_chain = COALESCE($5, deposit_chain),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        quotedRate,
        quoteExpiresAt,
        deposit?.address ?? null,
        deposit?.asset ?? null,
        deposit?.chain ?? null,
        id,
      ],
    );

    if (result.rows.length === 0) {
      throw new Error(`Intent not found: ${id}`);
    }

    return this.mapRow(result.rows[0]!);
  }

  /**
   * Find the intent that is expecting a deposit at the given address.
   *
   * Returns the most recent match: if the same address was reused across intents
   * (which the derivation strategy in ADR-005 aims to prevent), the newest
   * expectation is the one a transfer most likely belongs to.
   */
  async findAwaitingDepositAt(chain: string, address: string): Promise<PaymentIntent | null> {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM payment_intents
       WHERE deposit_chain = $1
         AND deposit_address = $2
         AND state IN ('QUOTED', 'AWAITING_PAYMENT', 'UNDERPAID')
       ORDER BY created_at DESC
       LIMIT 1`,
      [chain, address],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Find every intent currently expecting a deposit.
   *
   * The watcher builds its subscription set from this, so it must stay cheap:
   * backed by idx_intents_awaiting_deposit.
   */
  async findAwaitingDeposits(chain?: string): Promise<PaymentIntent[]> {
    const result = chain
      ? await query<Record<string, unknown>>(
          `SELECT * FROM payment_intents
           WHERE deposit_address IS NOT NULL
             AND deposit_chain = $1
             AND state IN ('QUOTED', 'AWAITING_PAYMENT', 'UNDERPAID')
           ORDER BY created_at ASC`,
          [chain],
        )
      : await query<Record<string, unknown>>(
          `SELECT * FROM payment_intents
           WHERE deposit_address IS NOT NULL
             AND state IN ('QUOTED', 'AWAITING_PAYMENT', 'UNDERPAID')
           ORDER BY created_at ASC`,
        );
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Count intents by state across all merchants.
   *
   * Used by the worker's readiness check to distinguish "running" from "keeping up".
   */
  async countByState(state: IntentState): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM payment_intents WHERE state = $1`,
      [state],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Map a database row to a PaymentIntent object.
   */
  private mapRow(row: Record<string, unknown>): PaymentIntent {
    return {
      id: String(row.id),
      merchant_id: String(row.merchant_id),
      order_ref: String(row.order_ref),
      target_amount: parseFloat(String(row.target_amount)),
      target_asset: String(row.target_asset),
      target_chain: String(row.target_chain),
      accepted_assets: row.accepted_assets as string[],
      quoted_rate: row.quoted_rate ? parseFloat(String(row.quoted_rate)) : null,
      quote_expires_at: row.quote_expires_at ? new Date(row.quote_expires_at as string) : null,
      deposit_address: row.deposit_address ? String(row.deposit_address) : null,
      deposit_asset: row.deposit_asset ? String(row.deposit_asset) : null,
      deposit_chain: row.deposit_chain ? String(row.deposit_chain) : null,
      state: String(row.state) as IntentState,
      version: Number(row.version),
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  /**
   * Map a database row to an IntentEvent object.
   */
  private mapEventRow(row: Record<string, unknown>): IntentEvent {
    return {
      id: String(row.id),
      intent_id: String(row.intent_id),
      event_type: String(row.event_type) as EventType,
      payload:
        typeof row.payload === 'string'
          ? (JSON.parse(row.payload) as Record<string, unknown>)
          : (row.payload as Record<string, unknown>),
      version: Number(row.version),
      created_at: new Date(row.created_at as string),
    };
  }

  /**
   * Map an event type to the expected next state.
   */
  private getExpectedNextState(eventType: EventType): IntentState {
    const mapping: Record<EventType, IntentState> = {
      INTENT_CREATED: 'CREATED',
      QUOTE_GENERATED: 'QUOTED',
      PAYMENT_AWAITED: 'AWAITING_PAYMENT',
      QUOTE_EXPIRED: 'EXPIRED',
      DEPOSIT_DETECTED: 'DETECTED',
      CONFIRMATION_RECEIVED: 'CONFIRMING',
      ROUTE_SELECTED: 'ROUTING',
      SETTLEMENT_INITIATED: 'SETTLING',
      SETTLEMENT_CONFIRMED: 'SETTLED',
      UNDERPAYMENT_DETECTED: 'UNDERPAID',
      OVERPAYMENT_DETECTED: 'OVERPAID',
      MISDIRECTED_PAYMENT: 'MISDIRECTED',
      REFUND_INITIATED: 'REFUNDING',
      REFUND_CONFIRMED: 'SETTLED',
      FAILED: 'FAILED',
    };
    return mapping[eventType];
  }
}
