/**
 * Settlement & Reconciliation Service
 * Merchant payout and financial accounting.
 */

// Repositories
export { SettlementRepository } from './settlement.repository.js';
export type { CreateSettlementParams, UpdateSettlementParams, DatabaseClient } from './settlement.repository.js';

export { LedgerRepository } from './ledger.repository.js';
export type { CreateLedgerEntryParams } from './ledger.repository.js';

// Services
export { LedgerService } from './ledger.service.js';
export type { DepositRecord, FeeRecord, RefundRecord, LedgerStatement } from './ledger.service.js';

export { SettlementService } from './settlement.service.js';
export type { SettlementExecutionContext } from './settlement.service.js';

// Re-export shared types
export type {
  Settlement,
  SettlementStatus,
  LedgerEntry,
  LedgerEntryType,
  ReconciliationReport,
  Discrepancy,
  MerchantConfig,
} from '@crypto-gateway/shared';
