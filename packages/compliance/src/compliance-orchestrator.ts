import type {
  IRiskScorer,
  RiskResult,
  ComplianceResult,
  TransactionInfo,
} from '@crypto-gateway/shared';
import { ScreeningUnavailableError } from '@crypto-gateway/shared';
import { VelocityChecker, type VelocityCheckResult } from './velocity-checker.js';

/**
 * Audit log entry for compliance decisions.
 */
export interface AuditLogEntry {
  id: string;
  intentId: string;
  address: string;
  chain: string;
  action: string;
  decision: 'ALLOW' | 'BLOCK' | 'REVIEW';
  riskScore: number;
  riskLevel: string;
  flags: string[];
  details: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Compliance Orchestrator Configuration.
 */
export interface ComplianceConfig {
  /** Maximum risk score allowed without manual review */
  autoBlockThreshold: number;
  /** Risk score requiring manual review */
  reviewThreshold: number;
  /** Whether to enable velocity checks */
  enableVelocityChecks: boolean;
  /** Velocity window configuration */
  velocityWindowMs: number;
  /** Maximum transactions per window */
  velocityMaxTransactions: number;
  /** Maximum amount per window */
  velocityMaxAmount: number;
}

const DEFAULT_CONFIG: ComplianceConfig = {
  autoBlockThreshold: 90,
  reviewThreshold: 70,
  enableVelocityChecks: true,
  velocityWindowMs: 60 * 60 * 1000, // 1 hour
  velocityMaxTransactions: 20,
  velocityMaxAmount: 100000,
};

/**
 * Compliance Orchestrator
 *
 * Central entry point for all compliance checks.
 * Orchestrates multiple risk scorers and checks:
 * 1. Risk scoring (Chainalysis/TRM)
 * 2. Velocity checks
 * 3. Sanctions screening
 * 4. KYC threshold checks
 * 5. Audit logging
 *
 * Screening Points:
 * - Intent Creation: Screen source address
 * - Deposit Detection: Screen incoming transaction
 * - Settlement: Screen destination address
 */
export class ComplianceOrchestrator {
  private readonly riskScorer: IRiskScorer;
  private readonly velocityChecker: VelocityChecker;
  private readonly config: ComplianceConfig;
  private readonly auditLog: AuditLogEntry[] = [];

  constructor(riskScorer: IRiskScorer, config?: Partial<ComplianceConfig>) {
    this.riskScorer = riskScorer;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.velocityChecker = new VelocityChecker({
      window: {
        durationMs: this.config.velocityWindowMs,
        maxTransactions: this.config.velocityMaxTransactions,
        maxAmount: this.config.velocityMaxAmount,
      },
    });
  }

  /**
   * Screen an address at intent creation.
   * FAIL-CLOSED: If screening is unavailable, block the payment.
   */
  async screenIntentCreation(
    intentId: string,
    sourceAddress: string,
    chain: string,
    amount: number,
  ): Promise<ComplianceResult> {
    try {
      // 1. Risk scoring
      const sourceRisk = await this.riskScorer.screenAddress(sourceAddress, chain);

      // 2. Velocity checks
      let velocityResult: VelocityCheckResult | null = null;
      if (this.config.enableVelocityChecks) {
        velocityResult = this.velocityChecker.checkVelocity({
          from: sourceAddress,
          to: '',
          amount,
          asset: '',
          chain,
          timestamp: new Date(),
        });
      }

      // 3. Determine compliance decision
      const decision = this.makeDecision(sourceRisk, velocityResult, amount);

      // 4. Log audit entry
      this.logAuditEntry({
        intentId,
        address: sourceAddress,
        chain,
        action: 'INTENT_CREATION',
        decision: decision.blocked ? 'BLOCK' : 'ALLOW',
        riskScore: sourceRisk.riskScore,
        riskLevel: sourceRisk.riskLevel,
        flags: [...sourceRisk.flags, ...(velocityResult?.flags ?? [])],
        details: {
          amount,
          velocityExceeded: velocityResult?.exceeded ?? false,
        },
      });

      return {
        intentId,
        sourceRisk,
        destinationRisk: null,
        kycRequired: amount > 10000, // KYC threshold
        kycVerified: false,
        blocked: decision.blocked,
        blockReason: decision.reason,
        screenedAt: new Date(),
      };
    } catch (error) {
      // FAIL-CLOSED: If screening fails, block the payment
      if (error instanceof ScreeningUnavailableError) {
        this.logAuditEntry({
          intentId,
          address: sourceAddress,
          chain,
          action: 'INTENT_CREATION',
          decision: 'BLOCK',
          riskScore: -1,
          riskLevel: 'UNKNOWN',
          flags: [],
          details: {
            amount,
            screeningError: error.message,
            failClosed: true,
          },
        });

        return {
          intentId,
          sourceRisk: null,
          destinationRisk: null,
          kycRequired: true,
          kycVerified: false,
          blocked: true,
          blockReason: `Screening unavailable: ${error.message}. Payment blocked (fail-closed).`,
          screenedAt: new Date(),
        };
      }
      throw error;
    }
  }

  /**
   * Screen a deposit transaction.
   * FAIL-CLOSED: If screening is unavailable, block the payment.
   */
  async screenDeposit(intentId: string, tx: TransactionInfo): Promise<ComplianceResult> {
    try {
      // 1. Transaction screening
      const sourceRisk = await this.riskScorer.screenTransaction(tx);

      // 2. Velocity checks
      let velocityResult: VelocityCheckResult | null = null;
      if (this.config.enableVelocityChecks) {
        velocityResult = this.velocityChecker.checkVelocity(tx);
      }

      // 3. Determine decision
      const decision = this.makeDecision(sourceRisk, velocityResult, tx.amount);

      // 4. Log audit entry
      this.logAuditEntry({
        intentId,
        address: tx.from,
        chain: tx.chain,
        action: 'DEPOSIT_DETECTION',
        decision: decision.blocked ? 'BLOCK' : 'ALLOW',
        riskScore: sourceRisk.riskScore,
        riskLevel: sourceRisk.riskLevel,
        flags: [...sourceRisk.flags, ...(velocityResult?.flags ?? [])],
        details: {
          amount: tx.amount,
          txHash: tx.from,
        },
      });

      return {
        intentId,
        sourceRisk,
        destinationRisk: null,
        kycRequired: tx.amount > 10000,
        kycVerified: false,
        blocked: decision.blocked,
        blockReason: decision.reason,
        screenedAt: new Date(),
      };
    } catch (error) {
      // FAIL-CLOSED: If screening fails, block the payment
      if (error instanceof ScreeningUnavailableError) {
        this.logAuditEntry({
          intentId,
          address: tx.from,
          chain: tx.chain,
          action: 'DEPOSIT_DETECTION',
          decision: 'BLOCK',
          riskScore: -1,
          riskLevel: 'UNKNOWN',
          flags: [],
          details: {
            amount: tx.amount,
            screeningError: error.message,
            failClosed: true,
          },
        });

        return {
          intentId,
          sourceRisk: null,
          destinationRisk: null,
          kycRequired: true,
          kycVerified: false,
          blocked: true,
          blockReason: `Screening unavailable: ${error.message}. Deposit blocked (fail-closed).`,
          screenedAt: new Date(),
        };
      }
      throw error;
    }
  }

  /**
   * Screen for settlement.
   * FAIL-CLOSED: If screening is unavailable, block the settlement.
   */
  async screenSettlement(
    intentId: string,
    destinationAddress: string,
    chain: string,
    amount: number,
  ): Promise<ComplianceResult> {
    try {
      // 1. Risk scoring for destination
      const destinationRisk = await this.riskScorer.screenAddress(destinationAddress, chain);

      // 2. Determine decision
      const decision = this.makeDecision(destinationRisk, null, amount);

      // 3. Log audit entry
      this.logAuditEntry({
        intentId,
        address: destinationAddress,
        chain,
        action: 'SETTLEMENT',
        decision: decision.blocked ? 'BLOCK' : 'ALLOW',
        riskScore: destinationRisk.riskScore,
        riskLevel: destinationRisk.riskLevel,
        flags: destinationRisk.flags,
        details: {
          amount,
        },
      });

      return {
        intentId,
        sourceRisk: null,
        destinationRisk,
        kycRequired: amount > 10000,
        kycVerified: false,
        blocked: decision.blocked,
        blockReason: decision.reason,
        screenedAt: new Date(),
      };
    } catch (error) {
      // FAIL-CLOSED: If screening fails, block the settlement
      if (error instanceof ScreeningUnavailableError) {
        this.logAuditEntry({
          intentId,
          address: destinationAddress,
          chain,
          action: 'SETTLEMENT',
          decision: 'BLOCK',
          riskScore: -1,
          riskLevel: 'UNKNOWN',
          flags: [],
          details: {
            amount,
            screeningError: error.message,
            failClosed: true,
          },
        });

        return {
          intentId,
          sourceRisk: null,
          destinationRisk: null,
          kycRequired: true,
          kycVerified: false,
          blocked: true,
          blockReason: `Screening unavailable: ${error.message}. Settlement blocked (fail-closed).`,
          screenedAt: new Date(),
        };
      }
      throw error;
    }
  }

  /**
   * Get audit log entries.
   */
  getAuditLog(filters?: {
    intentId?: string;
    address?: string;
    action?: string;
    decision?: 'ALLOW' | 'BLOCK' | 'REVIEW';
    startDate?: Date;
    endDate?: Date;
  }): AuditLogEntry[] {
    let log = [...this.auditLog];

    if (filters) {
      if (filters.intentId) {
        log = log.filter((e) => e.intentId === filters.intentId);
      }
      if (filters.address) {
        log = log.filter((e) => e.address === filters.address);
      }
      if (filters.action) {
        log = log.filter((e) => e.action === filters.action);
      }
      if (filters.decision) {
        log = log.filter((e) => e.decision === filters.decision);
      }
      if (filters.startDate) {
        log = log.filter((e) => e.timestamp >= filters.startDate!);
      }
      if (filters.endDate) {
        log = log.filter((e) => e.timestamp <= filters.endDate!);
      }
    }

    return log;
  }

  /**
   * Get compliance statistics.
   */
  getStats(): {
    totalScreenings: number;
    allowed: number;
    blocked: number;
    review: number;
    blockRate: number;
  } {
    const total = this.auditLog.length;
    const allowed = this.auditLog.filter((e) => e.decision === 'ALLOW').length;
    const blocked = this.auditLog.filter((e) => e.decision === 'BLOCK').length;
    const review = this.auditLog.filter((e) => e.decision === 'REVIEW').length;

    return {
      totalScreenings: total,
      allowed,
      blocked,
      review,
      blockRate: total > 0 ? (blocked / total) * 100 : 0,
    };
  }

  // ─── Private Methods ──────────────────────────────────────────────────

  private makeDecision(
    risk: RiskResult,
    velocity: VelocityCheckResult | null,
    amount: number,
  ): { blocked: boolean; reason: string | null } {
    // Block if sanctioned
    if (risk.flags.includes('SANCTIONED')) {
      return { blocked: true, reason: 'Address is on sanctions list' };
    }

    // Block if critical risk
    if (risk.riskLevel === 'CRITICAL') {
      return { blocked: true, reason: `Critical risk level (score: ${risk.riskScore})` };
    }

    // Block if high risk with large amount
    if (risk.riskLevel === 'HIGH' && amount > 50000) {
      return { blocked: true, reason: `High risk address with large amount ($${amount})` };
    }

    // Block if velocity exceeded
    if (velocity?.exceeded) {
      return { blocked: true, reason: 'Velocity limit exceeded' };
    }

    // Review if high risk
    if (risk.riskScore >= this.config.reviewThreshold) {
      return { blocked: false, reason: 'Requires manual review' };
    }

    return { blocked: false, reason: null };
  }

  private logAuditEntry(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    this.auditLog.push({
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
    });
  }
}
