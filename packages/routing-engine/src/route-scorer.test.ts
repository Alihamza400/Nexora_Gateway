import { describe, it, expect, beforeEach } from 'vitest';
import { RouteScorer, DEFAULT_PREFERENCES } from './route-scorer.js';
import type { RouteQuote } from '@crypto-gateway/shared';

// ─── Test Data ───────────────────────────────────────────────────────────

function makeQuote(overrides: Partial<RouteQuote> = {}): RouteQuote {
  return {
    id: `quote-${Date.now()}`,
    provider: 'lifi',
    source_chain: 'ethereum',
    source_asset: 'USDC',
    source_amount: 1000,
    target_chain: 'base',
    target_asset: 'USDC',
    target_amount: 999,
    steps: [],
    estimated_fee: 0.5,
    estimated_time: 30,
    security_score: 85,
    reliability_score: 90,
    expires_at: new Date(Date.now() + 60000),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('RouteScorer', () => {
  let scorer: RouteScorer;

  beforeEach(() => {
    scorer = new RouteScorer();
  });

  // ─── Default Preferences ─────────────────────────────────────────────

  describe('default preferences', () => {
    it('has sensible defaults', () => {
      const prefs = DEFAULT_PREFERENCES;
      expect(prefs.max_fee).toBe(100);
      expect(prefs.max_time).toBe(3600);
      expect(prefs.fee_weight).toBe(0.3);
      expect(prefs.time_weight).toBe(0.2);
      expect(prefs.security_weight).toBe(0.3);
      expect(prefs.reliability_weight).toBe(0.2);
    });

    it('weights sum to 1.0', () => {
      const prefs = DEFAULT_PREFERENCES;
      const sum = prefs.fee_weight + prefs.time_weight + prefs.security_weight + prefs.reliability_weight;
      expect(sum).toBeCloseTo(1.0);
    });
  });

  // ─── Scoring ─────────────────────────────────────────────────────────

  describe('score', () => {
    it('scores a low-fee route highly', () => {
      const quote = makeQuote({ estimated_fee: 0.1 });
      const score = scorer.score(quote);
      expect(score.fee_score).toBeGreaterThan(0.9);
    });

    it('scores a high-fee route poorly', () => {
      const quote = makeQuote({ estimated_fee: 90 });
      const score = scorer.score(quote);
      expect(score.fee_score).toBeLessThan(0.1);
    });

    it('scores a fast route highly', () => {
      const quote = makeQuote({ estimated_time: 10 });
      const score = scorer.score(quote);
      expect(score.time_score).toBeGreaterThan(0.9);
    });

    it('scores a slow route poorly', () => {
      const quote = makeQuote({ estimated_time: 3000 });
      const score = scorer.score(quote);
      expect(score.time_score).toBeLessThan(0.2);
    });

    it('normalizes security score from 0-100 to 0-1', () => {
      const quote = makeQuote({ security_score: 50 });
      const score = scorer.score(quote);
      expect(score.security_score).toBeCloseTo(0.5);
    });

    it('normalizes reliability score from 0-100 to 0-1', () => {
      const quote = makeQuote({ reliability_score: 75 });
      const score = scorer.score(quote);
      expect(score.reliability_score).toBeCloseTo(0.75);
    });

    it('returns total_score as weighted combination', () => {
      const quote = makeQuote({
        estimated_fee: 0,
        estimated_time: 0,
        security_score: 100,
        reliability_score: 100,
      });
      const score = scorer.score(quote);
      // Perfect scores → total should be 1.0
      expect(score.total_score).toBeCloseTo(1.0);
    });

    it('clamps fee score at 0 for negative fees', () => {
      const quote = makeQuote({ estimated_fee: -5 });
      const score = scorer.score(quote);
      expect(score.fee_score).toBe(1); // Negative fee = better than free
    });

    it('clamps time score at 0 for negative times', () => {
      const quote = makeQuote({ estimated_time: -5 });
      const score = scorer.score(quote);
      expect(score.time_score).toBe(1);
    });
  });

  // ─── Ranking ─────────────────────────────────────────────────────────

  describe('rank', () => {
    it('returns empty array for no quotes', () => {
      const ranked = scorer.rank([]);
      expect(ranked).toEqual([]);
    });

    it('ranks quotes by total_score descending', () => {
      const cheap = makeQuote({ id: 'cheap', estimated_fee: 0.1, estimated_time: 30 });
      const expensive = makeQuote({ id: 'expensive', estimated_fee: 50, estimated_time: 30 });

      const ranked = scorer.rank([expensive, cheap]);

      expect(ranked[0]!.quote.id).toBe('cheap');
      expect(ranked[1]!.quote.id).toBe('expensive');
    });

    it('ranks a single quote', () => {
      const quote = makeQuote({ id: 'solo' });
      const ranked = scorer.rank([quote]);
      expect(ranked).toHaveLength(1);
      expect(ranked[0]!.quote.id).toBe('solo');
    });
  });

  // ─── selectBest ──────────────────────────────────────────────────────

  describe('selectBest', () => {
    it('returns null for empty quotes', () => {
      expect(scorer.selectBest([])).toBeNull();
    });

    it('selects the best route', () => {
      const quotes = [
        makeQuote({ id: 'bad', estimated_fee: 80 }),
        makeQuote({ id: 'good', estimated_fee: 0.1 }),
        makeQuote({ id: 'mid', estimated_fee: 20 }),
      ];

      const result = scorer.selectBest(quotes);
      expect(result).not.toBeNull();
      expect(result!.quote.id).toBe('good');
    });

    it('returns score alongside quote', () => {
      const quotes = [makeQuote({ id: 'best' })];
      const result = scorer.selectBest(quotes);

      expect(result!.score).toHaveProperty('total_score');
      expect(result!.score).toHaveProperty('fee_score');
      expect(result!.score).toHaveProperty('time_score');
      expect(result!.score).toHaveProperty('security_score');
      expect(result!.score).toHaveProperty('reliability_score');
    });
  });

  // ─── Custom Preferences ──────────────────────────────────────────────

  describe('custom preferences', () => {
    it('respects custom fee weight', () => {
      const feeFocusedScorer = new RouteScorer({ fee_weight: 0.8, time_weight: 0.05, security_weight: 0.05, reliability_weight: 0.1 });

      const cheap = makeQuote({ id: 'cheap', estimated_fee: 0.1, estimated_time: 300 });
      const fast = makeQuote({ id: 'fast', estimated_fee: 10, estimated_time: 5 });

      const result = feeFocusedScorer.selectBest([cheap, fast]);
      expect(result!.quote.id).toBe('cheap');
    });

    it('respects custom time weight', () => {
      const timeFocusedScorer = new RouteScorer({ fee_weight: 0.05, time_weight: 0.8, security_weight: 0.05, reliability_weight: 0.1 });

      const cheap = makeQuote({ id: 'cheap', estimated_fee: 0.1, estimated_time: 300 });
      const fast = makeQuote({ id: 'fast', estimated_fee: 10, estimated_time: 5 });

      const result = timeFocusedScorer.selectBest([cheap, fast]);
      expect(result!.quote.id).toBe('fast');
    });

    it('getPreferences returns a copy', () => {
      const prefs = scorer.getPreferences();
      prefs.max_fee = 999;
      expect(scorer.getPreferences().max_fee).not.toBe(999);
    });
  });
});
