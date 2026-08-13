/**
 * Recovery Service
 * Failure mode handling: misdirected, underpaid, overpaid, stuck transactions.
 */

// Core service
export { RecoveryService } from './recovery.service.js';
export type { RecoveryServiceConfig } from './recovery.service.js';

// Repository
export { RecoveryRepository } from './recovery.repository.js';
export type { CreateRecoveryCaseParams, UpdateRecoveryCaseParams, DatabaseClient } from './recovery.repository.js';

// Re-export shared types
export type {
  RecoveryCase,
  RecoveryCaseType,
  RecoveryStatus,
  ResolutionAction,
  ResolutionResult,
  TopUpLink,
  OwnershipProof,
} from '@crypto-gateway/shared';
