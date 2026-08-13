/**
 * Reconciliation Service
 * Financial accuracy, period reconciliation, and audit readiness.
 */

// Core service
export { ReconciliationService } from './reconciliation.service.js';
export type { DatabaseClient } from './reconciliation.service.js';

// Re-export shared types
export type {
  IReconciliationService,
  ReconciliationRecord,
  ReconciliationPeriod,
  ReconciliationStatus,
  ReconciliationCheckResult,
  Discrepancy,
  DiscrepancyType,
  DiscrepancySeverity,
  DiscrepancySummary,
  FinancialSummary,
  FinancialReport,
  ChainFinancialSummary,
  MerchantFinancialSummary,
  FxGainLossEntry,
} from '@crypto-gateway/shared';
