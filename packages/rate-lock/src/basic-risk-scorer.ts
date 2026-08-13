/**
 * Basic Risk Scorer
 * Implements risk scoring using wallet age, transaction count, and sanctions checks.
 * This is the default/stub implementation; replace with Chainalysis/TRM in production.
 */

import type {
  IRiskScorer,
  RiskResult,
  RiskLevel,
  RiskFlag,
  TransactionInfo,
  BasicRiskScorerConfig,
  SanctionsEntry,
  SanctionsMatch,
  ISanctionsProvider,
} from '@crypto-gateway/shared';
import { DEFAULT_RISK_CONFIG } from '@crypto-gateway/shared';

// ─── Basic Risk Scorer ───────────────────────────────────────────────────────

export class BasicRiskScorer implements IRiskScorer {
  private config: BasicRiskScorerConfig;
  private sanctionsProvider: ISanctionsProvider | null;
  private cache = new Map<string, { score: number; expiresAt: number }>();

  constructor(
    config?: Partial<BasicRiskScorerConfig>,
    sanctionsProvider?: ISanctionsProvider,
  ) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.sanctionsProvider = sanctionsProvider ?? null;
  }

  async screenAddress(address: string, chain: string): Promise<RiskResult> {
    // Check cache first
    const cacheKey = `${address.toLowerCase()}:${chain}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return this.buildCachedResult(address, chain, cached.score);
    }

    // Calculate risk factors
    const factors = await this.calculateRiskFactors(address, chain);
    const flags = this.extractFlags(factors);

    // Sanctions match overrides total score to CRITICAL
    const sanctionsFactor = factors.find((f) => f.type === 'SANCTIONS');
    const hasSanctionsMatch = sanctionsFactor && sanctionsFactor.score >= 80;
    const totalScore = hasSanctionsMatch
      ? 100
      : this.calculateTotalScore(factors);
    const riskLevel = this.determineRiskLevel(totalScore);

    // Parse sanctions match details safely
    let sanctionsMatch: SanctionsMatch | null = null;
    if (sanctionsFactor && hasSanctionsMatch) {
      try {
        const parsed = JSON.parse(sanctionsFactor.details) as Record<string, unknown>;
        sanctionsMatch = {
          listName: String(parsed.listName ?? 'unknown'),
          matchScore: 100,
          entityName: String(parsed.entityName ?? 'unknown'),
          entityDetails: { reason: String(parsed.reason ?? 'unknown') },
        };
      } catch {
        sanctionsMatch = {
          listName: 'unknown',
          matchScore: 100,
          entityName: 'unknown',
          entityDetails: { reason: sanctionsFactor.details },
        };
      }
    }

    const result: RiskResult = {
      address,
      chain,
      riskScore: totalScore,
      riskLevel,
      flags,
      details: {
        sanctionsMatch,
        walletAge: factors.find((f) => f.type === 'WALLET_AGE')?.score ?? 0,
        transactionCount: factors.find((f) => f.type === 'TX_COUNT')?.score ?? 0,
        totalVolume: factors.find((f) => f.type === 'VOLUME')?.score ?? 0,
        knownAssociations: [],
        jurisdictionRisk: 0,
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.cacheTtlSeconds * 1000),
    };

    // Cache the result
    this.cache.set(cacheKey, {
      score: totalScore,
      expiresAt: result.expiresAt.getTime(),
    });

    return result;
  }

  async screenTransaction(tx: TransactionInfo): Promise<RiskResult> {
    // Screen the source address
    const sourceRisk = await this.screenAddress(tx.from, tx.chain);

    // Additional transaction-specific checks
    const txRiskFactors = this.calculateTransactionRisk(tx);
    const adjustedScore = Math.min(
      100,
      sourceRisk.riskScore + txRiskFactors.score,
    );

    return {
      ...sourceRisk,
      riskScore: adjustedScore,
      riskLevel: this.determineRiskLevel(adjustedScore),
      flags: [...sourceRisk.flags, ...txRiskFactors.flags],
    };
  }

  getRiskScore(address: string): Promise<number> {
    const cacheKey = `${address.toLowerCase()}:cached`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.score);
    }
    return Promise.resolve(0);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private async calculateRiskFactors(
    address: string,
    chain: string,
  ): Promise<Array<{ type: string; score: number; weight: number; details: string }>> {
    const factors: Array<{ type: string; score: number; weight: number; details: string }> = [];

    // 1. Sanctions check (highest weight)
    if (this.sanctionsProvider) {
      try {
        const sanctionsEntry = await this.sanctionsProvider.checkAddress(address, chain);
        if (sanctionsEntry) {
          factors.push({
            type: 'SANCTIONS',
            score: 100,
            weight: this.config.sanctionsWeight,
            details: JSON.stringify({
              listName: sanctionsEntry.listName,
              entityName: sanctionsEntry.entityName,
              reason: sanctionsEntry.reason,
            }),
          });
        } else {
          factors.push({
            type: 'SANCTIONS',
            score: 0,
            weight: this.config.sanctionsWeight,
            details: 'No sanctions match',
          });
        }
      } catch {
        // Sanctions check failed - assume safe but log
        factors.push({
          type: 'SANCTIONS',
          score: 0,
          weight: this.config.sanctionsWeight,
          details: 'Sanctions check unavailable',
        });
      }
    }

    // 2. Wallet age check (stub - in production, query chain)
    const walletAgeScore = this.estimateWalletAge(address);
    factors.push({
      type: 'WALLET_AGE',
      score: walletAgeScore,
      weight: this.config.walletAgeWeight,
      details: `Estimated wallet age score: ${walletAgeScore}/100`,
    });

    // 3. Transaction count check (stub - in production, query chain)
    const txCountScore = this.estimateTxCount(address);
    factors.push({
      type: 'TX_COUNT',
      score: txCountScore,
      weight: this.config.txCountWeight,
      details: `Estimated transaction count score: ${txCountScore}/100`,
    });

    // 4. Volume check (stub - in production, query chain)
    const volumeScore = this.estimateVolume(address);
    factors.push({
      type: 'VOLUME',
      score: volumeScore,
      weight: this.config.volumeWeight,
      details: `Estimated volume score: ${volumeScore}/100`,
    });

    return factors;
  }

  private calculateTotalScore(
    factors: Array<{ type: string; score: number; weight: number }>,
  ): number {
    if (factors.length === 0) return 0;

    // Weighted average
    let totalWeight = 0;
    let weightedSum = 0;

    for (const factor of factors) {
      totalWeight += factor.weight;
      weightedSum += factor.score * factor.weight;
    }

    if (totalWeight === 0) return 0;
    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  private determineRiskLevel(score: number): RiskLevel {
    if (score >= this.config.criticalRiskThreshold) return 'CRITICAL';
    if (score >= this.config.highRiskThreshold) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }

  private extractFlags(
    factors: Array<{ type: string; score: number }>,
  ): RiskFlag[] {
    const flags: RiskFlag[] = [];

    for (const factor of factors) {
      if (factor.score >= 80) {
        switch (factor.type) {
          case 'SANCTIONS':
            flags.push('SANCTIONED');
            break;
          case 'WALLET_AGE':
            flags.push('NEW_ADDRESS');
            break;
          default:
            break;
        }
      }
    }

    return flags;
  }

  private estimateWalletAge(address: string): number {
    // Stub: In production, query chain for first transaction timestamp
    // Lower score = older wallet = safer
    // For now, return a moderate score based on address pattern
    const hash = this.simpleHash(address);
    return hash % 60 + 20; // 20-80 range
  }

  private estimateTxCount(address: string): number {
    // Stub: In production, query chain for transaction count
    // Higher count = more established = safer
    const hash = this.simpleHash(address + ':txcount');
    return hash % 70 + 10; // 10-80 range
  }

  private estimateVolume(address: string): number {
    // Stub: In production, query chain for total volume
    const hash = this.simpleHash(address + ':volume');
    return hash % 60 + 20; // 20-80 range
  }

  private calculateTransactionRisk(tx: TransactionInfo): {
    score: number;
    flags: RiskFlag[];
  } {
    let score = 0;
    const flags: RiskFlag[] = [];

    // Large transaction check
    if (tx.amount > 100000) {
      score += 10;
    }

    // Round number check (potential structuring)
    if (tx.amount % 1000 === 0 && tx.amount > 0) {
      score += 5;
    }

    return { score, flags };
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  private buildCachedResult(
    address: string,
    chain: string,
    score: number,
  ): RiskResult {
    return {
      address,
      chain,
      riskScore: score,
      riskLevel: this.determineRiskLevel(score),
      flags: score >= 80 ? ['SANCTIONED'] : score >= 60 ? ['NEW_ADDRESS'] : [],
      details: {
        sanctionsMatch: null,
        walletAge: 0,
        transactionCount: 0,
        totalVolume: 0,
        knownAssociations: [],
        jurisdictionRisk: 0,
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.cacheTtlSeconds * 1000),
    };
  }
}

// ─── In-Memory Sanctions Provider (Stub) ─────────────────────────────────────

export class InMemorySanctionsProvider implements ISanctionsProvider {
  private entries: Map<string, SanctionsEntry> = new Map();

  constructor(initialEntries: SanctionsEntry[] = []) {
    for (const entry of initialEntries) {
      const key = `${entry.address.toLowerCase()}:${entry.chain}`;
      this.entries.set(key, entry);
    }
  }

  getName(): string {
    return 'in-memory';
  }

  checkAddress(address: string, chain: string): Promise<SanctionsEntry | null> {
    const key = `${address.toLowerCase()}:${chain}`;
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  getFlaggedAddresses(chain: string): Promise<SanctionsEntry[]> {
    return Promise.resolve(
      Array.from(this.entries.values()).filter(
        (entry) => entry.chain === chain,
      ),
    );
  }

  isHealthy(): Promise<boolean> {
    return Promise.resolve(true);
  }

  addEntry(entry: SanctionsEntry): void {
    const key = `${entry.address.toLowerCase()}:${entry.chain}`;
    this.entries.set(key, entry);
  }

  removeEntry(address: string, chain: string): boolean {
    const key = `${address.toLowerCase()}:${chain}`;
    return this.entries.delete(key);
  }
}
