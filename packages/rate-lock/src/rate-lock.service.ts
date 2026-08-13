/**
 * Rate Lock Service
 * Creates and manages rate locks for payment intents.
 * Protects merchants from volatility by locking exchange rates with a spread.
 */

import { randomUUID } from 'node:crypto';
import type {
  IPriceOracle,
  IRateLockService,
  RateLock,
  RateLockResult,
  SpreadConfig,
} from '@crypto-gateway/shared';
import {
  DEFAULT_SPREAD_CONFIG,
  HIGH_VOLATILITY_ASSETS,
  RateLockExpiredError,
  RateLockNotFoundError,
  RateLockAlreadyConsumedError,
} from '@crypto-gateway/shared';

// ─── In-Memory Rate Lock Store ───────────────────────────────────────────────
// In production, this would be backed by Redis/PostgreSQL

interface RateLockStore {
  locks: Map<string, RateLock>;
}

// ─── Rate Lock Service ───────────────────────────────────────────────────────

export class RateLockService implements IRateLockService {
  private store: RateLockStore = { locks: new Map() };
  private spreadConfig: SpreadConfig;
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private clock: () => Date;

  constructor(
    private priceOracle: IPriceOracle,
    spreadConfig?: Partial<SpreadConfig>,
    clock?: () => Date,
  ) {
    this.spreadConfig = { ...DEFAULT_SPREAD_CONFIG, ...spreadConfig };
    this.clock = clock ?? (() => new Date());
  }

  async createLock(
    intentId: string,
    merchantId: string,
    asset: string,
    baseAsset: string,
    ttlSeconds?: number,
  ): Promise<RateLockResult> {
    // Validate TTL
    const effectiveTtl = ttlSeconds ?? this.spreadConfig.defaultTtlSeconds;
    const clampedTtl = Math.max(
      this.spreadConfig.minTtlSeconds,
      Math.min(this.spreadConfig.maxTtlSeconds, effectiveTtl),
    );

    // Fetch live price
    const priceQuote = await this.priceOracle.getPrice(asset, baseAsset);
    const liveRate = priceQuote.price;

    if (liveRate <= 0) {
      throw new Error(`Invalid price for ${asset}/${baseAsset}: ${liveRate}`);
    }

    // Calculate spread based on volatility
    const spreadBps = this.calculateSpread(asset);

    // Apply spread to rate (merchant gets slightly worse rate to cover volatility)
    const spreadMultiplier = 1 + spreadBps / 10000;
    const lockedRate = liveRate * spreadMultiplier;

    const now = this.clock();
    const lock: RateLock = {
      id: randomUUID(),
      intentId,
      merchantId,
      asset: asset.toUpperCase(),
      baseAsset: baseAsset.toUpperCase(),
      lockedRate,
      liveRate,
      spreadBps,
      ttlSeconds: clampedTtl,
      status: 'ACTIVE',
      createdAt: now,
      expiresAt: new Date(now.getTime() + clampedTtl * 1000),
      consumedAt: null,
    };

    // Store the lock
    this.store.locks.set(lock.id, lock);

    return {
      lock,
      spreadApplied: spreadBps,
      paymentWindowSeconds: clampedTtl,
    };
  }

  getLock(intentId: string): Promise<RateLock | null> {
    for (const lock of this.store.locks.values()) {
      if (lock.intentId === intentId) {
        return Promise.resolve(lock);
      }
    }
    return Promise.resolve(null);
  }

  async consumeLock(intentId: string): Promise<RateLock> {
    const lock = await this.getLock(intentId);

    if (!lock) {
      throw new RateLockNotFoundError(intentId);
    }

    if (lock.status === 'EXPIRED') {
      throw new RateLockExpiredError(lock.id, intentId);
    }

    if (lock.status === 'CONSUMED') {
      throw new RateLockAlreadyConsumedError(lock.id);
    }

    // Check if expired
    if (this.clock() > lock.expiresAt) {
      lock.status = 'EXPIRED';
      this.store.locks.set(lock.id, lock);
      throw new RateLockExpiredError(lock.id, intentId);
    }

    // Consume the lock
    lock.status = 'CONSUMED';
    lock.consumedAt = this.clock();
    this.store.locks.set(lock.id, lock);

    return lock;
  }

  async cancelLock(intentId: string): Promise<void> {
    const lock = await this.getLock(intentId);

    if (lock) {
      lock.status = 'CANCELLED';
      this.store.locks.set(lock.id, lock);
    }
  }

  async isLockValid(intentId: string): Promise<boolean> {
    const lock = await this.getLock(intentId);

    if (!lock) return false;
    if (lock.status !== 'ACTIVE') return false;
    if (this.clock() > lock.expiresAt) {
      lock.status = 'EXPIRED';
      this.store.locks.set(lock.id, lock);
      return false;
    }

    return true;
  }

  getSpreadConfig(): SpreadConfig {
    return { ...this.spreadConfig };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private calculateSpread(asset: string): number {
    let spread = this.spreadConfig.baseSpreadBps;

    // Add volatility spread for high-volatility assets
    const upperAsset = asset.toUpperCase();
    if ((HIGH_VOLATILITY_ASSETS as readonly string[]).includes(upperAsset)) {
      spread += this.spreadConfig.volatilitySpreadBps;
    }

    // Cap at maximum
    return Math.min(spread, this.spreadConfig.maxSpreadBps);
  }
}

// ─── Rate Lock Cleanup Job ───────────────────────────────────────────────────

export class RateLockCleanupService {
  private store: RateLockStore;
  private cleanupIntervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(store: RateLockStore, cleanupIntervalSeconds: number = 60) {
    this.store = store;
    this.cleanupIntervalMs = cleanupIntervalSeconds * 1000;
  }

  start(): void {
    this.intervalId = setInterval(() => {
      this.cleanupExpiredLocks();
    }, this.cleanupIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  cleanupExpiredLocks(): number {
    const now = new Date();
    let cleanedCount = 0;

    for (const [id, lock] of this.store.locks.entries()) {
      if (lock.status === 'ACTIVE' && now > lock.expiresAt) {
        lock.status = 'EXPIRED';
        cleanedCount++;
      }

      // Remove old locks (older than 24 hours)
      const ageMs = now.getTime() - lock.createdAt.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        this.store.locks.delete(id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}
