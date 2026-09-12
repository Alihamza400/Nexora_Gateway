/**
 * Payment Intent Types
 * System of record for every payment attempt in the crypto gateway.
 */

// ─── Intent State Machine ────────────────────────────────────────────────────

export type IntentState =
  | 'CREATED'
  | 'QUOTED'
  | 'AWAITING_PAYMENT'
  | 'DETECTED'
  | 'CONFIRMING'
  | 'ROUTING'
  | 'SETTLING'
  | 'SETTLED'
  | 'UNDERPAID'
  | 'OVERPAID'
  | 'MISDIRECTED'
  | 'EXPIRED'
  | 'REFUNDING'
  | 'FAILED';

/**
 * Valid state transitions for the payment intent state machine.
 * Only these transitions are allowed.
 */
export const VALID_TRANSITIONS: Record<IntentState, IntentState[]> = {
  CREATED: ['QUOTED', 'EXPIRED', 'FAILED'],
  QUOTED: ['AWAITING_PAYMENT', 'EXPIRED', 'FAILED'],
  AWAITING_PAYMENT: ['DETECTED', 'EXPIRED', 'FAILED'],
  DETECTED: ['CONFIRMING', 'UNDERPAID', 'OVERPAID', 'MISDIRECTED'],
  CONFIRMING: ['ROUTING', 'FAILED'],
  ROUTING: ['SETTLING', 'FAILED'],
  SETTLING: ['SETTLED', 'FAILED'],
  SETTLED: [],
  UNDERPAID: ['AWAITING_PAYMENT', 'REFUNDING', 'FAILED'],
  OVERPAID: ['SETTLING', 'REFUNDING', 'FAILED'],
  MISDIRECTED: ['REFUNDING', 'FAILED'],
  EXPIRED: [],
  REFUNDING: ['SETTLED', 'FAILED'],
  FAILED: [],
};

// ─── Payment Intent ──────────────────────────────────────────────────────────

export interface PaymentIntent {
  id: string;
  merchant_id: string;
  order_ref: string;
  target_amount: number;
  target_asset: string;
  target_chain: string;
  accepted_assets: string[];
  quoted_rate: number | null;
  /**
   * Where the customer should send funds. Populated when the quote is generated.
   * Null before quoting; the deposit watcher resolves incoming transfers to
   * intents through this pair.
   */
  deposit_address: string | null;
  deposit_asset: string | null;
  deposit_chain: string | null;
  quote_expires_at: Date | null;
  state: IntentState;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface NewPaymentIntent {
  merchant_id: string;
  order_ref: string;
  target_amount: number;
  target_asset: string;
  target_chain: string;
  accepted_assets: string[];
}

// ─── Intent Events ───────────────────────────────────────────────────────────

export type EventType =
  | 'INTENT_CREATED'
  | 'QUOTE_GENERATED'
  /** Customer accepted the quote; deposit address is live and being watched. */
  | 'PAYMENT_AWAITED'
  | 'QUOTE_EXPIRED'
  | 'DEPOSIT_DETECTED'
  | 'CONFIRMATION_RECEIVED'
  | 'ROUTE_SELECTED'
  | 'SETTLEMENT_INITIATED'
  | 'SETTLEMENT_CONFIRMED'
  | 'UNDERPAYMENT_DETECTED'
  | 'OVERPAYMENT_DETECTED'
  | 'MISDIRECTED_PAYMENT'
  | 'REFUND_INITIATED'
  | 'REFUND_CONFIRMED'
  | 'FAILED';

export interface IntentEvent {
  // Note: every EventType must be handled in
  // PaymentIntentRepository.getExpectedNextState — the Record<EventType, IntentState>
  // type makes an omission a compile error, which is intentional.
  id: string;
  intent_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  version: number;
  created_at: Date;
}

// ─── Quote ───────────────────────────────────────────────────────────────────

export interface Quote {
  rate: number;
  expires_at: Date;
  deposit_address: string;
  deposit_asset: string;
  deposit_chain: string;
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  intent_id: string;
  event_type: EventType;
  state: IntentState;
  timestamp: Date;
  data: Record<string, unknown>;
  signature: string;
}
