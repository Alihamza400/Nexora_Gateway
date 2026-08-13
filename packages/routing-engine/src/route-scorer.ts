/**
 * Route Scorer
 *
 * Scores candidate routes on multiple dimensions and selects the optimal path.
 * Uses weighted scoring with normalization to handle different scales.
 *
 * Scoring dimensions:
 *   - Fee score: Lower fees = higher score
 *   - Time score: Faster execution = higher score
 *   - Security score: Provider-provided security rating
 *   - Reliability score: Provider-provided reliability rating
 */

import type { RouteQuote, RouteScore, MerchantPreferences } from '@crypto-gateway/shared';

/** Default merchant preferences (balanced) */
export const DEFAULT_PREFERENCES: MerchantPreferences = {
  max_fee: 100,        // Max acceptable fee in USD
  max_time: 3600,      // Max acceptable time in seconds (1 hour)
  fee_weight: 0.3,     // 30% weight on fees
  time_weight: 0.2,    // 20% weight on speed
  security_weight: 0.3, // 30% weight on security
  reliability_weight: 0.2, // 20% weight on reliability
};

export class RouteScorer {
  private readonly preferences: MerchantPreferences;

  constructor(preferences?: Partial<MerchantPreferences>) {
    this.preferences = { ...DEFAULT_PREFERENCES, ...preferences };
  }

  /**
   * Score a single route quote.
   */
  score(quote: RouteQuote): RouteScore {
    const feeScore = this.normalizeFeeScore(quote.estimated_fee);
    const timeScore = this.normalizeTimeScore(quote.estimated_time);
    const securityScore = this.normalizeSecurityScore(quote.security_score);
    const reliabilityScore = this.normalizeReliabilityScore(quote.reliability_score);

    const totalScore =
      feeScore * this.preferences.fee_weight +
      timeScore * this.preferences.time_weight +
      securityScore * this.preferences.security_weight +
      reliabilityScore * this.preferences.reliability_weight;

    return {
      total_score: totalScore,
      fee_score: feeScore,
      time_score: timeScore,
      security_score: securityScore,
      reliability_score: reliabilityScore,
    };
  }

  /**
   * Score and rank multiple quotes. Returns sorted by total_score descending.
   */
  rank(quotes: RouteQuote[]): Array<{ quote: RouteQuote; score: RouteScore }> {
    return quotes
      .map((quote) => ({ quote, score: this.score(quote) }))
      .sort((a, b) => b.score.total_score - a.score.total_score);
  }

  /**
   * Select the best route from multiple quotes.
   */
  selectBest(quotes: RouteQuote[]): { quote: RouteQuote; score: RouteScore } | null {
    if (quotes.length === 0) return null;

    const ranked = this.rank(quotes);
    return ranked[0] ?? null;
  }

  /**
   * Normalize fee score: 0 (expensive) to 1 (free).
   * Uses linear normalization with max_fee as the upper bound.
   */
  private normalizeFeeScore(fee: number): number {
    if (fee <= 0) return 1;
    return Math.max(0, 1 - fee / this.preferences.max_fee);
  }

  /**
   * Normalize time score: 0 (slow) to 1 (instant).
   * Uses linear normalization with max_time as the upper bound.
   */
  private normalizeTimeScore(time: number): number {
    if (time <= 0) return 1;
    return Math.max(0, 1 - time / this.preferences.max_time);
  }

  /**
   * Normalize security score to 0-1 range.
   * Expects input in 0-100 range, normalizes to 0-1.
   */
  private normalizeSecurityScore(score: number): number {
    return Math.max(0, Math.min(1, score / 100));
  }

  /**
   * Normalize reliability score to 0-1 range.
   * Expects input in 0-100 range, normalizes to 0-1.
   */
  private normalizeReliabilityScore(score: number): number {
    return Math.max(0, Math.min(1, score / 100));
  }

  /**
   * Get current preferences.
   */
  getPreferences(): MerchantPreferences {
    return { ...this.preferences };
  }
}
