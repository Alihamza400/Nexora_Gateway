/**
 * Compliance Gate
 * Central entry point for all compliance checks before allowing transactions.
 * Combines risk scoring, sanctions screening, and KYC requirements.
 */

import type {
  IComplianceGate,
  IRiskScorer,
  ComplianceGateResult,
  RiskAssessment,
  TransactionInfo,
  RiskLevel,
  RiskFlag,
  RiskFactor,
} from '@crypto-gateway/shared';

// ─── Compliance Gate ─────────────────────────────────────────────────────────

export class ComplianceGate implements IComplianceGate {
  private riskScorer: IRiskScorer;
  private blockedAddresses: Set<string> = new Set();
  private blockedChains: Set<string> = new Set();

  constructor(riskScorer: IRiskScorer) {
    this.riskScorer = riskScorer;
  }

  async checkAddress(
    address: string,
    chain: string,
    amount: number,
  ): Promise<ComplianceGateResult> {
    // Quick checks first
    if (this.blockedAddresses.has(address.toLowerCase())) {
      const riskAssessment = this.buildBlockedAssessment(address, chain);
      return {
        allowed: false,
        reason: 'Address is manually blocked',
        riskAssessment,
      };
    }

    if (this.blockedChains.has(chain)) {
      const riskAssessment = this.buildBlockedAssessment(address, chain);
      return {
        allowed: false,
        reason: `Chain ${chain} is not supported`,
        riskAssessment,
      };
    }

    // Full risk screening
    const riskResult = await this.riskScorer.screenAddress(address, chain);

    const riskAssessment = this.buildRiskAssessment(
      address,
      chain,
      riskResult.riskScore,
      riskResult.riskLevel,
      riskResult.flags,
    );

    // Block if sanctioned (check first - most important)
    if (riskResult.flags.includes('SANCTIONED')) {
      return {
        allowed: false,
        reason: 'Address is on sanctions list',
        riskAssessment,
      };
    }

    // Block if CRITICAL risk
    if (riskResult.riskLevel === 'CRITICAL') {
      return {
        allowed: false,
        reason: `Address has CRITICAL risk level (score: ${riskResult.riskScore})`,
        riskAssessment,
      };
    }

    // HIGH risk requires manual review for large amounts
    if (riskResult.riskLevel === 'HIGH' && amount > 50000) {
      return {
        allowed: false,
        reason: `High-risk address with large transaction amount ($${amount})`,
        riskAssessment,
      };
    }

    return {
      allowed: true,
      riskAssessment,
    };
  }

  async checkTransaction(tx: TransactionInfo): Promise<ComplianceGateResult> {
    // Screen the transaction
    const riskResult = await this.riskScorer.screenTransaction(tx);

    const riskAssessment = this.buildRiskAssessment(
      tx.from,
      tx.chain,
      riskResult.riskScore,
      riskResult.riskLevel,
      riskResult.flags,
    );

    // Block if CRITICAL risk
    if (riskResult.riskLevel === 'CRITICAL') {
      return {
        allowed: false,
        reason: `Transaction has CRITICAL risk level (score: ${riskResult.riskScore})`,
        riskAssessment,
      };
    }

    // Block if sanctioned
    if (riskResult.flags.includes('SANCTIONED')) {
      return {
        allowed: false,
        reason: 'Source address is on sanctions list',
        riskAssessment,
      };
    }

    // Check for mixer/darknet association
    if (
      riskResult.flags.includes('MIXER') ||
      riskResult.flags.includes('DARKNET')
    ) {
      return {
        allowed: false,
        reason: 'Source address associated with mixer or darknet',
        riskAssessment,
      };
    }

    return {
      allowed: true,
      riskAssessment,
    };
  }

  // ─── Management Methods ──────────────────────────────────────────────────

  blockAddress(address: string): void {
    this.blockedAddresses.add(address.toLowerCase());
  }

  unblockAddress(address: string): void {
    this.blockedAddresses.delete(address.toLowerCase());
  }

  blockChain(chain: string): void {
    this.blockedChains.add(chain);
  }

  unblockChain(chain: string): void {
    this.blockedChains.delete(chain);
  }

  getBlockedAddresses(): string[] {
    return Array.from(this.blockedAddresses);
  }

  getBlockedChains(): string[] {
    return Array.from(this.blockedChains);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private buildRiskAssessment(
    address: string,
    chain: string,
    totalScore: number,
    riskLevel: RiskLevel,
    flags: RiskFlag[],
  ): RiskAssessment {
    const factors: RiskFactor[] = [];

    if (flags.includes('SANCTIONED')) {
      factors.push({
        type: 'SANCTIONS',
        score: 100,
        weight: 0.4,
        details: 'Address is on sanctions list',
      });
    }

    if (flags.includes('NEW_ADDRESS')) {
      factors.push({
        type: 'WALLET_AGE',
        score: 80,
        weight: 0.2,
        details: 'New wallet detected',
      });
    }

    if (flags.includes('MIXER')) {
      factors.push({
        type: 'MIXER',
        score: 90,
        weight: 0.3,
        details: 'Address associated with mixer',
      });
    }

    if (flags.includes('DARKNET')) {
      factors.push({
        type: 'DARKNET',
        score: 95,
        weight: 0.3,
        details: 'Address associated with darknet',
      });
    }

    return {
      address,
      chain,
      totalScore,
      riskLevel,
      factors,
      flags,
      assessedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    };
  }

  private buildBlockedAssessment(
    address: string,
    chain: string,
  ): RiskAssessment {
    return {
      address,
      chain,
      totalScore: 100,
      riskLevel: 'CRITICAL',
      factors: [],
      flags: ['SANCTIONED'],
      assessedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    };
  }
}
