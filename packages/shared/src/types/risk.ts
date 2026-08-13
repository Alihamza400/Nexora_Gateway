/**
 * Risk Scoring Types
 * Basic risk assessment for payment intents.
 */

import type { RiskLevel, RiskFlag, TransactionInfo } from './compliance.js';

// Re-export IRiskScorer from compliance for convenience
export type { IRiskScorer } from './compliance.js';

// ─── Basic Risk Scorer (Stub) ────────────────────────────────────────────────

export interface BasicRiskScorerConfig {
  /** Weight for wallet age factor (0-1) */
  walletAgeWeight: number;
  /** Weight for transaction count factor (0-1) */
  txCountWeight: number;
  /** Weight for volume factor (0-1) */
  volumeWeight: number;
  /** Weight for sanctions factor (0-1) */
  sanctionsWeight: number;
  /** Threshold for HIGH risk (0-100) */
  highRiskThreshold: number;
  /** Threshold for CRITICAL risk (0-100) */
  criticalRiskThreshold: number;
  /** Cache TTL for risk scores in seconds */
  cacheTtlSeconds: number;
}

export const DEFAULT_RISK_CONFIG: BasicRiskScorerConfig = {
  walletAgeWeight: 0.2,
  txCountWeight: 0.2,
  volumeWeight: 0.2,
  sanctionsWeight: 0.4,
  highRiskThreshold: 60,
  criticalRiskThreshold: 80,
  cacheTtlSeconds: 3600, // 1 hour
};

// ─── Sanctions List ──────────────────────────────────────────────────────────

export interface SanctionsEntry {
  address: string;
  chain: string;
  listName: string;
  entityName: string;
  addedAt: Date;
  reason: string;
}

export interface ISanctionsProvider {
  getName(): string;
  checkAddress(address: string, chain: string): Promise<SanctionsEntry | null>;
  getFlaggedAddresses(chain: string): Promise<SanctionsEntry[]>;
  isHealthy(): Promise<boolean>;
}

// ─── Risk Factor ─────────────────────────────────────────────────────────────

export interface RiskFactor {
  type: 'WALLET_AGE' | 'TX_COUNT' | 'VOLUME' | 'SANCTIONS' | 'VELOCITY' | 'MIXER' | 'DARKNET';
  score: number; // 0-100
  weight: number;
  details: string;
}

export interface RiskAssessment {
  address: string;
  chain: string;
  totalScore: number;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  flags: RiskFlag[];
  assessedAt: Date;
  expiresAt: Date;
}

// ─── Compliance Gate ─────────────────────────────────────────────────────────

export type ComplianceGateResult =
  | { allowed: true; riskAssessment: RiskAssessment }
  | { allowed: false; reason: string; riskAssessment: RiskAssessment };

export interface IComplianceGate {
  /**
   * Check if an address is allowed to transact.
   * Returns allowed: true if address passes all checks.
   */
  checkAddress(address: string, chain: string, amount: number): Promise<ComplianceGateResult>;

  /**
   * Check if a transaction is allowed.
   */
  checkTransaction(tx: TransactionInfo): Promise<ComplianceGateResult>;
}
