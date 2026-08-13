/**
 * Compliance Types
 * KYC/AML and sanctions screening types.
 */

// ─── Risk Assessment ─────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskFlag =
  | 'SANCTIONED'
  | 'MIXER'
  | 'DARKNET'
  | 'SCAM'
  | 'HIGH_RISK_JURISDICTION'
  | 'VELOCITY_ANOMALY'
  | 'NEW_ADDRESS';

export interface RiskResult {
  address: string;
  chain: string;
  riskScore: number;
  riskLevel: RiskLevel;
  flags: RiskFlag[];
  details: RiskDetails;
  screenedAt: Date;
  expiresAt: Date;
}

export interface RiskDetails {
  sanctionsMatch: SanctionsMatch | null;
  walletAge: number;
  transactionCount: number;
  totalVolume: number;
  knownAssociations: string[];
  jurisdictionRisk: number;
}

export interface SanctionsMatch {
  listName: string;
  matchScore: number;
  entityName: string;
  entityDetails: Record<string, unknown>;
}

// ─── Risk Scorer Interface ───────────────────────────────────────────────────

export interface TransactionInfo {
  from: string;
  to: string;
  amount: number;
  asset: string;
  chain: string;
  timestamp: Date;
}

export interface IRiskScorer {
  screenAddress(address: string, chain: string): Promise<RiskResult>;
  screenTransaction(tx: TransactionInfo): Promise<RiskResult>;
  getRiskScore(address: string): Promise<number>;
}

// ─── Compliance Result ───────────────────────────────────────────────────────

export interface ComplianceResult {
  intentId: string;
  sourceRisk: RiskResult | null;
  destinationRisk: RiskResult | null;
  kycRequired: boolean;
  kycVerified: boolean;
  blocked: boolean;
  blockReason: string | null;
  screenedAt: Date;
}
