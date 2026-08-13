/**
 * Reconciliation Types
 * Financial accuracy, period reconciliation, and audit readiness.
 */

// ─── Reconciliation Period ────────────────────────────────────────────────

export type ReconciliationPeriod = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

// ─── Reconciliation Status ────────────────────────────────────────────────

export type ReconciliationStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DISCREPANCY_FOUND'
  | 'FAILED';

// ─── Discrepancy Types ────────────────────────────────────────────────────

export type DiscrepancyType =
  | 'AMOUNT_MISMATCH'           // Settlement amount doesn't match rate-locked amount
  | 'MISSING_SETTLEMENT'        // Ledger entry exists but no settlement record
  | 'MISSING_LEDGER_ENTRY'      // Settlement exists but no ledger entry
  | 'DUPLICATE_SETTLEMENT'      // Multiple settlements for same intent
  | 'FX_GAIN_LOSS_MISMATCH'     // FX gain/loss calculation incorrect
  | 'FEE_CALCULATION_ERROR'     // Fee amount doesn't match expected
  | 'ON_CHAIN_MISMATCH';        // On-chain transaction doesn't match ledger

export type DiscrepancySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── Reconciliation Record ────────────────────────────────────────────────

export interface ReconciliationRecord {
  id: string;
  period: ReconciliationPeriod;
  startDate: Date;
  endDate: Date;
  status: ReconciliationStatus;
  totalIntents: number;
  totalSettled: number;
  totalPending: number;
  totalFailed: number;
  totalDiscrepancies: number;
  discrepancySummary: DiscrepancySummary;
  financialSummary: FinancialSummary;
  createdAt: Date;
  completedAt: Date | null;
}

// ─── Discrepancy Summary ──────────────────────────────────────────────────

export interface DiscrepancySummary {
  totalDiscrepancies: number;
  byType: Record<DiscrepancyType, number>;
  bySeverity: Record<DiscrepancySeverity, number>;
  criticalDiscrepancies: Discrepancy[];
}

// ─── Financial Summary ────────────────────────────────────────────────────

export interface FinancialSummary {
  /** Total settled amount in USD */
  totalSettledUsd: number;
  /** Total fees collected in USD */
  totalFeesUsd: number;
  /** Total FX gain in USD */
  totalFxGainUsd: number;
  /** Total FX loss in USD */
  totalFxLossUsd: number;
  /** Net FX impact */
  netFxImpactUsd: number;
  /** Settlement success rate */
  settlementSuccessRate: number;
  /** Average settlement time (seconds) */
  averageSettlementTime: number;
}

// ─── Discrepancy ──────────────────────────────────────────────────────────

export interface Discrepancy {
  id: string;
  reconciliationRecordId: string;
  type: DiscrepancyType;
  severity: DiscrepancySeverity;
  intentId: string;
  description: string;
  expectedValue: unknown;
  actualValue: unknown;
  difference: number | null;
  metadata: Record<string, unknown>;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
}

// ─── Reconciliation Check Result ──────────────────────────────────────────

export interface ReconciliationCheckResult {
  passed: boolean;
  record: ReconciliationRecord;
  discrepancies: Discrepancy[];
  duration: number; // milliseconds
}

// ─── Financial Report ─────────────────────────────────────────────────────

export interface FinancialReport {
  id: string;
  period: ReconciliationPeriod;
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  summary: FinancialSummary;
  byChain: ChainFinancialSummary[];
  byMerchant: MerchantFinancialSummary[];
  fxGainLossDetails: FxGainLossEntry[];
}

export interface ChainFinancialSummary {
  chainId: string;
  chainName: string;
  totalSettled: number;
  totalSettledUsd: number;
  totalFees: number;
  totalTransactions: number;
  successRate: number;
}

export interface MerchantFinancialSummary {
  merchantId: string;
  merchantName: string;
  totalSettled: number;
  totalSettledUsd: number;
  totalFees: number;
  totalTransactions: number;
}

export interface FxGainLossEntry {
  intentId: string;
  asset: string;
  chain: string;
  lockedRate: number;
  actualRate: number;
  gainLoss: number;
  gainLossUsd: number;
  recordedAt: Date;
}

// ─── Reconciliation Service Interface ─────────────────────────────────────

export interface IReconciliationService {
  /**
   * Run reconciliation for a specific period.
   */
  runReconciliation(
    period: ReconciliationPeriod,
    startDate: Date,
    endDate: Date,
  ): Promise<ReconciliationCheckResult>;

  /**
   * Get a reconciliation record by ID.
   */
  getRecord(id: string): Promise<ReconciliationRecord | null>;

  /**
   * Get reconciliation records for a date range.
   */
  getRecords(
    startDate: Date,
    endDate: Date,
  ): Promise<ReconciliationRecord[]>;

  /**
   * Generate a financial report.
   */
  generateFinancialReport(
    period: ReconciliationPeriod,
    startDate: Date,
    endDate: Date,
  ): Promise<FinancialReport>;

  /**
   * Export reconciliation data.
   */
  exportData(
    recordId: string,
    format: 'CSV' | 'JSON',
  ): Promise<string>;
}
