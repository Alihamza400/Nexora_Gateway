import type { RiskFlag, TransactionInfo } from '@crypto-gateway/shared';

/**
 * Velocity window configuration.
 */
interface VelocityWindow {
  /** Window duration in milliseconds */
  durationMs: number;
  /** Maximum number of transactions allowed in window */
  maxTransactions: number;
  /** Maximum total amount allowed in window */
  maxAmount: number;
}

/**
 * Velocity check result.
 */
export interface VelocityCheckResult {
  /** Whether velocity limit was exceeded */
  exceeded: boolean;
  /** Velocity risk score (0-100) */
  score: number;
  /** Flags triggered by velocity checks */
  flags: RiskFlag[];
  /** Details about the velocity check */
  details: {
    transactionCount: number;
    totalAmount: number;
    averageAmount: number;
    timeSinceLastTransaction: number;
    windowDuration: number;
  };
}

/**
 * Velocity Checker
 *
 * Detects suspicious transaction patterns:
 * - High frequency transactions (potential bot activity)
 * - Large volume in short time (potential laundering)
 * - Structuring patterns (transactions just below thresholds)
 * - Rapid succession transactions (potential front-running)
 *
 * Uses sliding window approach for accurate detection.
 */
export class VelocityChecker {
  private readonly windows: Map<string, TransactionRecord[]> = new Map();
  private readonly config: VelocityConfig;

  constructor(config?: Partial<VelocityConfig>) {
    this.config = { ...DEFAULT_VELOCITY_CONFIG, ...config };
  }

  /**
   * Check velocity for a transaction.
   */
  checkVelocity(tx: TransactionInfo): VelocityCheckResult {
    const addressKey = `${tx.from.toLowerCase()}:${tx.chain}`;
    const records = this.getWindowRecords(addressKey);

    // Add current transaction
    records.push({
      amount: tx.amount,
      timestamp: tx.timestamp.getTime(),
    });

    // Clean old records
    const now = Date.now();
    const validRecords = records.filter(
      (r) => now - r.timestamp <= this.config.window.durationMs,
    );

    // Update stored records
    this.windows.set(addressKey, validRecords);

    // Calculate velocity metrics
    const transactionCount = validRecords.length;
    const totalAmount = validRecords.reduce((sum, r) => sum + r.amount, 0);
    const averageAmount = transactionCount > 0 ? totalAmount / transactionCount : 0;

    // Calculate time since last transaction
    const sortedByTime = [...validRecords].sort((a, b) => b.timestamp - a.timestamp);
    const timeSinceLastTransaction = sortedByTime.length > 1 && sortedByTime[0] && sortedByTime[1]
      ? sortedByTime[0].timestamp - sortedByTime[1].timestamp
      : Infinity;

    // Check velocity limits
    const exceeded =
      transactionCount > this.config.window.maxTransactions ||
      totalAmount > this.config.window.maxAmount;

    // Calculate velocity risk score
    const score = this.calculateVelocityScore(
      transactionCount,
      totalAmount,
      averageAmount,
      timeSinceLastTransaction,
    );

    // Determine flags
    const flags = this.determineFlags(
      transactionCount,
      totalAmount,
      averageAmount,
      timeSinceLastTransaction,
    );

    return {
      exceeded,
      score,
      flags,
      details: {
        transactionCount,
        totalAmount,
        averageAmount,
        timeSinceLastTransaction,
        windowDuration: this.config.window.durationMs,
      },
    };
  }

  /**
   * Get velocity history for an address.
   */
  getHistory(address: string, chain: string): TransactionRecord[] {
    const key = `${address.toLowerCase()}:${chain}`;
    return this.getWindowRecords(key);
  }

  /**
   * Clear velocity history for an address.
   */
  clearHistory(address: string, chain: string): void {
    const key = `${address.toLowerCase()}:${chain}`;
    this.windows.delete(key);
  }

  /**
   * Clear all velocity history.
   */
  clearAll(): void {
    this.windows.clear();
  }

  // ─── Private Methods ──────────────────────────────────────────────────

  private getWindowRecords(key: string): TransactionRecord[] {
    return this.windows.get(key) ?? [];
  }

  /**
   * Calculate velocity risk score (0-100).
   */
  private calculateVelocityScore(
    transactionCount: number,
    totalAmount: number,
    averageAmount: number,
    timeSinceLastTx: number,
  ): number {
    let score = 0;

    // High transaction count (normalized to 0-30)
    const countScore = Math.min(30, (transactionCount / this.config.window.maxTransactions) * 30);
    score += countScore;

    // High total amount (normalized to 0-30)
    const amountScore = Math.min(30, (totalAmount / this.config.window.maxAmount) * 30);
    score += amountScore;

    // Large average amount (normalized to 0-20)
    const avgScore = Math.min(20, (averageAmount / 10000) * 20);
    score += avgScore;

    // Rapid succession (normalized to 0-20)
    if (timeSinceLastTx < 60000) { // Less than 1 minute
      score += 20;
    } else if (timeSinceLastTx < 300000) { // Less than 5 minutes
      score += 10;
    }

    return Math.min(100, Math.round(score));
  }

  /**
   * Determine velocity-based flags.
   */
  private determineFlags(
    transactionCount: number,
    _totalAmount: number,
    averageAmount: number,
    timeSinceLastTx: number,
  ): RiskFlag[] {
    const flags: RiskFlag[] = [];

    // Velocity anomaly if many transactions in short time
    if (transactionCount > this.config.window.maxTransactions * 0.8) {
      flags.push('VELOCITY_ANOMALY');
    }

    // Structuring detection: many transactions just below threshold
    if (transactionCount > 5 && averageAmount > 9000 && averageAmount < 10000) {
      flags.push('VELOCITY_ANOMALY');
    }

    // Rapid succession
    if (timeSinceLastTx < 60000 && transactionCount > 3) {
      flags.push('VELOCITY_ANOMALY');
    }

    return flags;
  }
}

/**
 * Transaction record for velocity tracking.
 */
export interface TransactionRecord {
  amount: number;
  timestamp: number;
}

/**
 * Velocity configuration.
 */
export interface VelocityConfig {
  /** Default velocity window */
  window: VelocityWindow;
  /** Structuring threshold (USD) */
  structuringThreshold: number;
  /** Rapid succession threshold (ms) */
  rapidSuccessionThresholdMs: number;
}

const DEFAULT_VELOCITY_CONFIG: VelocityConfig = {
  window: {
    durationMs: 60 * 60 * 1000, // 1 hour
    maxTransactions: 20,
    maxAmount: 100000,
  },
  structuringThreshold: 10000,
  rapidSuccessionThresholdMs: 60000, // 1 minute
};
