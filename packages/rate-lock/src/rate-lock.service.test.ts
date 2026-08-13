/**
 * RateLockService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLockService } from './rate-lock.service.js';
import type { IPriceOracle, PriceQuote, SpreadConfig } from '@crypto-gateway/shared';
import {
  RateLockExpiredError,
  RateLockNotFoundError,
  RateLockAlreadyConsumedError,
} from '@crypto-gateway/shared';

// ─── Mock Price Oracle ───────────────────────────────────────────────────────

function createMockOracle(price: number): IPriceOracle {
  return {
    getName: () => 'mock',
    getPrice: vi.fn().mockResolvedValue({
      asset: 'BTC',
      baseAsset: 'USD',
      price,
      timestamp: new Date(),
      source: 'mock',
      confidence: 0.95,
    } as PriceQuote),
    getPrices: vi.fn().mockResolvedValue([]),
    isHealthy: vi.fn().mockResolvedValue(true),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RateLockService', () => {
  let service: RateLockService;
  let mockOracle: IPriceOracle;
  let fakeTime: number;

  beforeEach(() => {
    fakeTime = Date.now();
    mockOracle = createMockOracle(50000); // $50,000 BTC
    service = new RateLockService(
      mockOracle,
      undefined,
      () => new Date(fakeTime),
    );
  });

  describe('createLock', () => {
    it('should create a rate lock with default spread', async () => {
      const result = await service.createLock(
        'intent-1',
        'merchant-1',
        'BTC',
        'USD',
      );

      expect(result.lock).toBeDefined();
      expect(result.lock.intentId).toBe('intent-1');
      expect(result.lock.merchantId).toBe('merchant-1');
      expect(result.lock.asset).toBe('BTC');
      expect(result.lock.baseAsset).toBe('USD');
      expect(result.lock.status).toBe('ACTIVE');
      expect(result.lock.liveRate).toBe(50000);
      expect(result.lock.lockedRate).toBeGreaterThan(50000); // Spread applied
      expect(result.spreadApplied).toBe(50); // Default base spread
      expect(result.paymentWindowSeconds).toBe(300); // Default TTL
    });

    it('should apply higher spread for high-volatility assets', async () => {
      const result = await service.createLock(
        'intent-2',
        'merchant-1',
        'DOGE',
        'USD',
      );

      // DOGE is high-volatility, should have extra spread
      expect(result.spreadApplied).toBe(75); // 50 base + 25 volatility
      expect(result.lock.lockedRate).toBeGreaterThan(result.lock.liveRate);
    });

    it('should respect custom TTL', async () => {
      const result = await service.createLock(
        'intent-3',
        'merchant-1',
        'BTC',
        'USD',
        120, // 2 minutes
      );

      expect(result.paymentWindowSeconds).toBe(120);
      expect(result.lock.ttlSeconds).toBe(120);
    });

    it('should clamp TTL to min/max bounds', async () => {
      // Too short
      const result1 = await service.createLock(
        'intent-4',
        'merchant-1',
        'BTC',
        'USD',
        10, // Below minimum (60s)
      );
      expect(result1.paymentWindowSeconds).toBe(60);

      // Too long
      const result2 = await service.createLock(
        'intent-5',
        'merchant-1',
        'BTC',
        'USD',
        9999, // Above maximum (600s)
      );
      expect(result2.paymentWindowSeconds).toBe(600);
    });

    it('should throw on zero/negative price', async () => {
      mockOracle = createMockOracle(0);
      service = new RateLockService(mockOracle);

      await expect(
        service.createLock('intent-6', 'merchant-1', 'BTC', 'USD'),
      ).rejects.toThrow('Invalid price');
    });
  });

  describe('getLock', () => {
    it('should return lock by intent ID', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD');
      const lock = await service.getLock('intent-1');

      expect(lock).not.toBeNull();
      expect(lock!.intentId).toBe('intent-1');
    });

    it('should return null for non-existent intent', async () => {
      const lock = await service.getLock('non-existent');
      expect(lock).toBeNull();
    });
  });

  describe('consumeLock', () => {
    it('should consume an active lock', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD');
      const consumed = await service.consumeLock('intent-1');

      expect(consumed.status).toBe('CONSUMED');
      expect(consumed.consumedAt).toBeDefined();
    });

    it('should throw if lock not found', async () => {
      await expect(service.consumeLock('non-existent')).rejects.toThrow(
        RateLockNotFoundError,
      );
    });

    it('should throw if lock already consumed', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD');
      await service.consumeLock('intent-1');

      await expect(service.consumeLock('intent-1')).rejects.toThrow(
        RateLockAlreadyConsumedError,
      );
    });

    it('should throw if lock is expired', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD', 1);

      // Get the lock and manually expire it
      const lock = await service.getLock('intent-1');
      expect(lock).not.toBeNull();

      // Directly set expiresAt to past
      lock!.expiresAt = new Date(Date.now() - 1000);

      await expect(service.consumeLock('intent-1')).rejects.toThrow(
        RateLockExpiredError,
      );
    });
  });

  describe('cancelLock', () => {
    it('should cancel an active lock', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD');
      await service.cancelLock('intent-1');

      const lock = await service.getLock('intent-1');
      expect(lock!.status).toBe('CANCELLED');
    });

    it('should not throw for non-existent intent', async () => {
      await expect(service.cancelLock('non-existent')).resolves.not.toThrow();
    });
  });

  describe('isLockValid', () => {
    it('should return true for active, non-expired lock', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD');
      const valid = await service.isLockValid('intent-1');
      expect(valid).toBe(true);
    });

    it('should return false for expired lock', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD', 1);

      // Get the lock and manually expire it
      const lock = await service.getLock('intent-1');
      expect(lock).not.toBeNull();

      // Directly set expiresAt to past
      lock!.expiresAt = new Date(Date.now() - 1000);

      const valid = await service.isLockValid('intent-1');
      expect(valid).toBe(false);
    });

    it('should return false for consumed lock', async () => {
      await service.createLock('intent-1', 'merchant-1', 'BTC', 'USD');
      await service.consumeLock('intent-1');

      const valid = await service.isLockValid('intent-1');
      expect(valid).toBe(false);
    });

    it('should return false for non-existent intent', async () => {
      const valid = await service.isLockValid('non-existent');
      expect(valid).toBe(false);
    });
  });

  describe('getSpreadConfig', () => {
    it('should return default spread config', () => {
      const config = service.getSpreadConfig();
      expect(config.baseSpreadBps).toBe(50);
      expect(config.volatilitySpreadBps).toBe(25);
      expect(config.maxSpreadBps).toBe(200);
      expect(config.defaultTtlSeconds).toBe(300);
    });

    it('should return custom spread config', () => {
      const customConfig: Partial<SpreadConfig> = {
        baseSpreadBps: 100,
        defaultTtlSeconds: 600,
      };
      const customService = new RateLockService(mockOracle, customConfig);
      const config = customService.getSpreadConfig();

      expect(config.baseSpreadBps).toBe(100);
      expect(config.defaultTtlSeconds).toBe(600);
    });
  });
});
