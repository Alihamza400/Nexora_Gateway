/**
 * Settlement Types
 * Merchant payout and financial accounting types.
 */

// ─── Settlement ──────────────────────────────────────────────────────────────

export type SettlementStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING';

export interface Settlement {
  id: string;
  intent_id: string;
  merchant_id: string;
  amount: number;
  asset: string;
  chain: string;
  destination_address: string;
  status: SettlementStatus;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

// ─── Ledger Entry ────────────────────────────────────────────────────────────

export type LedgerEntryType = 'DEPOSIT' | 'FEE' | 'SETTLEMENT' | 'REFUND' | 'FX_GAIN_LOSS';

export interface LedgerEntry {
  id: string;
  intent_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  asset: string;
  chain: string;
  debit_account: string;
  credit_account: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

export type DiscrepancyType = 'AMOUNT_MISMATCH' | 'MISSING_SETTLEMENT' | 'DUPLICATE_SETTLEMENT' | 'INVALID_STATUS';

export interface Discrepancy {
  type: DiscrepancyType;
  intent_id: string;
  expected: number;
  actual: number;
  difference: number;
  description: string;
}

export interface ReconciliationReport {
  id: string;
  period: string;
  total_intents: number;
  total_settled: number;
  total_pending: number;
  total_failed: number;
  discrepancies: Discrepancy[];
  generated_at: Date;
}

// ─── Merchant Config ─────────────────────────────────────────────────────────

export interface MerchantConfig {
  id: string;
  name: string;
  settlement_asset: string;
  settlement_chain: string;
  settlement_address: string;
  accepted_chains: string[];
  accepted_assets: string[];
  fee_percentage: number;
  kyc_threshold: number;
  quote_ttl_seconds: number;
  webhook_url: string | null;
  compliance_status: string;
  created_at: Date;
  updated_at: Date;
}
