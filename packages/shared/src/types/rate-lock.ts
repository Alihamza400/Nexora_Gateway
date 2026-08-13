/**
 * Rate Lock & Price Oracle Types
 * Handles volatility protection for merchants via rate locking.
 */

// ─── Price Oracle ────────────────────────────────────────────────────────────

export interface PriceQuote {
  asset: string;
  baseAsset: string;
  price: number;
  timestamp: Date;
  source: string;
  confidence: number; // 0-1, how confident we are in this price
}

export interface IPriceOracle {
  getName(): string;
  getPrice(asset: string, baseAsset: string): Promise<PriceQuote>;
  getPrices(assets: string[], baseAsset: string): Promise<PriceQuote[]>;
  isHealthy(): Promise<boolean>;
}

// ─── Rate Lock ───────────────────────────────────────────────────────────────

export type RateLockStatus = 'ACTIVE' | 'EXPIRED' | 'CONSUMED' | 'CANCELLED';

export interface RateLock {
  id: string;
  intentId: string;
  merchantId: string;
  asset: string;
  baseAsset: string;
  lockedRate: number;
  liveRate: number;
  spreadBps: number; // basis points spread added to live rate
  ttlSeconds: number;
  status: RateLockStatus;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface RateLockResult {
  lock: RateLock;
  /** Spread in basis points applied to protect against volatility */
  spreadApplied: number;
  /** Time window merchant has to complete payment */
  paymentWindowSeconds: number;
}

export interface IRateLockService {
  /**
   * Create a rate lock for a payment intent.
   * Fetches live rate, applies spread, and locks for TTL.
   */
  createLock(
    intentId: string,
    merchantId: string,
    asset: string,
    baseAsset: string,
    ttlSeconds?: number,
  ): Promise<RateLockResult>;

  /**
   * Get the current locked rate for an intent.
   * Returns null if lock has expired.
   */
  getLock(intentId: string): Promise<RateLock | null>;

  /**
   * Consume a rate lock when settlement occurs.
   * Uses the locked rate for settlement calculation.
   */
  consumeLock(intentId: string): Promise<RateLock>;

  /**
   * Cancel a rate lock (e.g., intent cancelled).
   */
  cancelLock(intentId: string): Promise<void>;

  /**
   * Check if a lock is still valid.
   */
  isLockValid(intentId: string): Promise<boolean>;

  /**
   * Get the current spread configuration.
   */
  getSpreadConfig(): SpreadConfig;
}

// ─── Spread Configuration ────────────────────────────────────────────────────

export interface SpreadConfig {
  /** Base spread in basis points (e.g., 50 = 0.5%) */
  baseSpreadBps: number;
  /** Additional spread for high-volatility assets */
  volatilitySpreadBps: number;
  /** Maximum total spread cap in basis points */
  maxSpreadBps: number;
  /** Default TTL for rate locks in seconds */
  defaultTtlSeconds: number;
  /** Minimum TTL for rate locks in seconds */
  minTtlSeconds: number;
  /** Maximum TTL for rate locks in seconds */
  maxTtlSeconds: number;
}

export const DEFAULT_SPREAD_CONFIG: SpreadConfig = {
  baseSpreadBps: 50, // 0.5%
  volatilitySpreadBps: 25, // 0.25% for volatile assets
  maxSpreadBps: 200, // 2% max
  defaultTtlSeconds: 300, // 5 minutes
  minTtlSeconds: 60, // 1 minute
  maxTtlSeconds: 600, // 10 minutes
};

// ─── High Volatility Assets ──────────────────────────────────────────────────

export const HIGH_VOLATILITY_ASSETS = [
  'DOGE',
  'SHIB',
  'PEPE',
  'FLOKI',
  'WIF',
  'BONK',
  'ARB',
  'OP',
  'MATIC',
] as const;

export type HighVolatilityAsset = (typeof HIGH_VOLATILITY_ASSETS)[number];

// ─── Treasury Buffer ─────────────────────────────────────────────────────────

export interface TreasuryBuffer {
  chain: string;
  asset: string;
  hotWalletBalance: number;
  warmWalletBalance: number;
  coldWalletBalance: number;
  /** Buffer percentage to maintain in hot wallet (e.g., 0.1 = 10%) */
  bufferPercentage: number;
  /** Replenish threshold - when hot wallet drops below this, sweep from warm */
  replenishThreshold: number;
  /** Sweep threshold - when warm wallet exceeds this, move to cold */
  sweepThreshold: number;
}

export interface ITreasuryService {
  getBuffer(chain: string, asset: string): Promise<TreasuryBuffer>;
  needsReplenishment(chain: string, asset: string): Promise<boolean>;
  sweepToWarm(address: string, chain: string): Promise<string>;
  replenishHotWallet(chain: string, amount: number): Promise<string>;
}
