/**
 * Compliance Layer
 * KYC/AML screening, velocity checks, and audit logging.
 */

// Risk Scoring Adapters
export { ChainalysisRiskScorer } from './chainalysis-risk-scorer.js';
export { TRMRiskScorer, type TRMExposureSummary } from './trm-risk-scorer.js';

// Velocity Checking
export { VelocityChecker, type VelocityCheckResult, type VelocityConfig } from './velocity-checker.js';

// Compliance Orchestrator
export { ComplianceOrchestrator, type ComplianceConfig, type AuditLogEntry } from './compliance-orchestrator.js';

// Re-export shared types
export type {
  IRiskScorer,
  RiskResult,
  RiskLevel,
  RiskFlag,
  ComplianceResult,
  TransactionInfo,
  SanctionsMatch,
} from '@crypto-gateway/shared';
