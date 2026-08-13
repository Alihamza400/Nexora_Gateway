import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({ failureThreshold: 3, recoveryTimeout: 5000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Initial State ─────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('starts with 0 failures', () => {
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  // ─── Successful Execution ─────────────────────────────────────────────

  describe('successful execution', () => {
    it('returns the result of the function', async () => {
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('resets failure count on success', async () => {
      // Trigger some failures
      await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      expect(breaker.getFailureCount()).toBe(2);

      // Success resets
      await breaker.execute(async () => 'ok');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('keeps circuit CLOSED on success', async () => {
      await breaker.execute(async () => 'ok');
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  // ─── Failure Threshold ────────────────────────────────────────────────

  describe('failure threshold', () => {
    it('increments failure count on each failure', async () => {
      await breaker.execute(async () => { throw new Error('fail1'); }).catch(() => {});
      expect(breaker.getFailureCount()).toBe(1);

      await breaker.execute(async () => { throw new Error('fail2'); }).catch(() => {});
      expect(breaker.getFailureCount()).toBe(2);
    });

    it('opens circuit after reaching failure threshold', async () => {
      await breaker.execute(async () => { throw new Error('fail1'); }).catch(() => {});
      await breaker.execute(async () => { throw new Error('fail2'); }).catch(() => {});
      await breaker.execute(async () => { throw new Error('fail3'); }).catch(() => {});

      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.getFailureCount()).toBe(3);
    });

    it('throws CircuitOpenError when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
    });

    it('CircuitOpenError contains retryAfterMs', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      try {
        await breaker.execute(async () => 'ok');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        expect((error as CircuitOpenError).retryAfterMs).toBeGreaterThan(0);
      }
    });
  });

  // ─── Recovery Timeout (OPEN → HALF_OPEN) ─────────────────────────────

  describe('recovery timeout', () => {
    it('transitions from OPEN to HALF_OPEN after recovery timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(breaker.getState()).toBe('OPEN');

      // Advance time past recovery timeout
      vi.advanceTimersByTime(5001);

      expect(breaker.getState()).toBe('HALF_OPEN');
    });

    it('does not transition to HALF_OPEN before recovery timeout', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      vi.advanceTimersByTime(3000);
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  // ─── HALF_OPEN State ─────────────────────────────────────────────────

  describe('HALF_OPEN state', () => {
    it('transitions to CLOSED on success from HALF_OPEN', async () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      // Wait for recovery
      vi.advanceTimersByTime(5001);

      // Execute succeeds
      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('transitions back to OPEN on failure from HALF_OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      vi.advanceTimersByTime(5001);

      await breaker.execute(async () => { throw new Error('still broken'); }).catch(() => {});

      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.getFailureCount()).toBe(4);
    });
  });

  // ─── Reset ────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('resets to CLOSED state from OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }
      expect(breaker.getState()).toBe('OPEN');

      breaker.reset();

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('allows execution after reset', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error('fail'); }).catch(() => {});
      }

      breaker.reset();

      const result = await breaker.execute(async () => 'ok after reset');
      expect(result).toBe('ok after reset');
    });
  });

  // ─── Default Options ─────────────────────────────────────────────────

  describe('default options', () => {
    it('uses default threshold of 5 and recovery of 30s', () => {
      const defaultBreaker = new CircuitBreaker();
      expect(defaultBreaker.getState()).toBe('CLOSED');
    });
  });
});
