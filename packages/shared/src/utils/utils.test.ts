import { describe, it, expect, vi } from 'vitest';
import {
  generateId,
  isValidTransition,
  sleep,
  retryWithBackoff,
  normalizeFeeScore,
  normalizeTimeScore,
  isValidAmount,
  isValidEvmAddress,
} from './index.js';

describe('Shared Utilities', () => {
  // ─── generateId ──────────────────────────────────────────────────────

  describe('generateId', () => {
    it('generates a UUID v4', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });

  // ─── isValidTransition ───────────────────────────────────────────────

  describe('isValidTransition', () => {
    const transitions: Record<string, string[]> = {
      CREATED: ['QUOTED', 'EXPIRED'],
      QUOTED: ['AWAITING_PAYMENT'],
    };

    it('returns true for valid transitions', () => {
      expect(isValidTransition(transitions, 'CREATED', 'QUOTED')).toBe(true);
      expect(isValidTransition(transitions, 'CREATED', 'EXPIRED')).toBe(true);
      expect(isValidTransition(transitions, 'QUOTED', 'AWAITING_PAYMENT')).toBe(true);
    });

    it('returns false for invalid transitions', () => {
      expect(isValidTransition(transitions, 'CREATED', 'SETTLED')).toBe(false);
      expect(isValidTransition(transitions, 'QUOTED', 'CREATED')).toBe(false);
    });

    it('returns false for unknown states', () => {
      expect(isValidTransition(transitions, 'UNKNOWN', 'CREATED')).toBe(false);
    });
  });

  // ─── sleep ───────────────────────────────────────────────────────────

  describe('sleep', () => {
    it('resolves after specified time', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });

    it('resolves immediately for 0ms', async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ─── retryWithBackoff ───────────────────────────────────────────────

  describe('retryWithBackoff', () => {
    it('returns result on first success', async () => {
      const fn = vi.fn(async () => 'success');
      const result = await retryWithBackoff(fn, 3, 10);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success after retries';
      });

      const result = await retryWithBackoff(fn, 3, 10);
      expect(result).toBe('success after retries');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after max retries', async () => {
      const fn = vi.fn(async () => { throw new Error('always fails'); });

      await expect(retryWithBackoff(fn, 2, 10)).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  // ─── normalizeFeeScore ──────────────────────────────────────────────

  describe('normalizeFeeScore', () => {
    it('returns 1 for zero fee', () => {
      expect(normalizeFeeScore(0, 100)).toBe(1);
    });

    it('returns 0 for max fee', () => {
      expect(normalizeFeeScore(100, 100)).toBe(0);
    });

    it('returns 0.5 for half max fee', () => {
      expect(normalizeFeeScore(50, 100)).toBe(0.5);
    });

    it('clamps to 0 for fees above max', () => {
      expect(normalizeFeeScore(150, 100)).toBe(0);
    });
  });

  // ─── normalizeTimeScore ─────────────────────────────────────────────

  describe('normalizeTimeScore', () => {
    it('returns 1 for zero time', () => {
      expect(normalizeTimeScore(0, 1000)).toBe(1);
    });

    it('returns 0 for max time', () => {
      expect(normalizeTimeScore(1000, 1000)).toBe(0);
    });

    it('returns 0.5 for half max time', () => {
      expect(normalizeTimeScore(500, 1000)).toBe(0.5);
    });

    it('clamps to 0 for times above max', () => {
      expect(normalizeTimeScore(1500, 1000)).toBe(0);
    });
  });

  // ─── isValidAmount ──────────────────────────────────────────────────

  describe('isValidAmount', () => {
    it('returns true for valid amounts', () => {
      expect(isValidAmount(100)).toBe(true);
      expect(isValidAmount(0)).toBe(true);
      expect(isValidAmount(0.5)).toBe(true);
    });

    it('returns false for NaN', () => {
      expect(isValidAmount(NaN)).toBe(false);
    });

    it('returns false for negative amounts', () => {
      expect(isValidAmount(-1)).toBe(false);
    });

    it('respects min/max bounds', () => {
      expect(isValidAmount(5, 10, 20)).toBe(false);
      expect(isValidAmount(15, 10, 20)).toBe(true);
      expect(isValidAmount(25, 10, 20)).toBe(false);
    });
  });

  // ─── isValidEvmAddress ──────────────────────────────────────────────

  describe('isValidEvmAddress', () => {
    it('validates correct EVM addresses', () => {
      expect(isValidEvmAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true);
      expect(isValidEvmAddress('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(isValidEvmAddress('0xabcdefABCDEFabcdefABCDEFabcdefABCDEFabcd')).toBe(true);
    });

    it('rejects invalid addresses', () => {
      expect(isValidEvmAddress('not-an-address')).toBe(false);
      expect(isValidEvmAddress('0x123')).toBe(false);
      expect(isValidEvmAddress('')).toBe(false);
      expect(isValidEvmAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
    });

    it('rejects non-EVM addresses', () => {
      expect(isValidEvmAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(false);
    });

    it('rejects addresses with wrong length', () => {
      expect(isValidEvmAddress('0x1234567890')).toBe(false);
      expect(isValidEvmAddress('0x' + 'a'.repeat(41))).toBe(false);
    });
  });
});
