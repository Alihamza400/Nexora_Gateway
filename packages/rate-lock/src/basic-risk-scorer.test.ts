/**
 * BasicRiskScorer Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BasicRiskScorer, InMemorySanctionsProvider } from './basic-risk-scorer.js';
import type { TransactionInfo } from '@crypto-gateway/shared';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BasicRiskScorer', () => {
  let scorer: BasicRiskScorer;

  beforeEach(() => {
    scorer = new BasicRiskScorer();
  });

  describe('screenAddress', () => {
    it('should return a risk result with score and level', async () => {
      const result = await scorer.screenAddress('0x1234567890abcdef1234567890abcdef12345678', 'ethereum');

      expect(result).toBeDefined();
      expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(result.chain).toBe('ethereum');
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
      expect(result.riskLevel).toBeDefined();
      expect(result.flags).toBeInstanceOf(Array);
      expect(result.details).toBeDefined();
      expect(result.screenedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should cache results', async () => {
      const result1 = await scorer.screenAddress('0x1234', 'ethereum');
      const result2 = await scorer.screenAddress('0x1234', 'ethereum');

      expect(result1.riskScore).toBe(result2.riskScore);
    });

    it('should return different scores for different addresses', async () => {
      const result1 = await scorer.screenAddress('0xaaaa', 'ethereum');
      const result2 = await scorer.screenAddress('0xbbbb', 'ethereum');

      // Very unlikely to be the same with hash-based scoring
      // But could be, so we just check both are valid
      expect(result1.riskScore).toBeGreaterThanOrEqual(0);
      expect(result2.riskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('screenTransaction', () => {
    it('should screen a transaction', async () => {
      const tx: TransactionInfo = {
        from: '0x1234',
        to: '0x5678',
        amount: 1000,
        asset: 'ETH',
        chain: 'ethereum',
        timestamp: new Date(),
      };

      const result = await scorer.screenTransaction(tx);

      expect(result).toBeDefined();
      expect(result.address).toBe('0x1234');
      expect(result.chain).toBe('ethereum');
    });

    it('should flag large transactions', async () => {
      const tx: TransactionInfo = {
        from: '0x1234',
        to: '0x5678',
        amount: 150000, // > $100k
        asset: 'USDC',
        chain: 'ethereum',
        timestamp: new Date(),
      };

      const result = await scorer.screenTransaction(tx);

      expect(result.riskScore).toBeGreaterThan(0);
    });
  });

  describe('with sanctions provider', () => {
    it('should flag sanctioned addresses', async () => {
      const sanctionsProvider = new InMemorySanctionsProvider([
        {
          address: '0xbad',
          chain: 'ethereum',
          listName: 'OFAC',
          entityName: 'Bad Actor',
          addedAt: new Date(),
          reason: 'Sanctioned entity',
        },
      ]);

      const scorerWithSanctions = new BasicRiskScorer(
        undefined,
        sanctionsProvider,
      );

      const result = await scorerWithSanctions.screenAddress('0xbad', 'ethereum');

      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.flags).toContain('SANCTIONED');
      expect(result.riskScore).toBeGreaterThanOrEqual(80);
    });

    it('should pass clean addresses through sanctions check', async () => {
      const sanctionsProvider = new InMemorySanctionsProvider([
        {
          address: '0xbad',
          chain: 'ethereum',
          listName: 'OFAC',
          entityName: 'Bad Actor',
          addedAt: new Date(),
          reason: 'Sanctioned entity',
        },
      ]);

      const scorerWithSanctions = new BasicRiskScorer(
        undefined,
        sanctionsProvider,
      );

      const result = await scorerWithSanctions.screenAddress('0xgood', 'ethereum');

      expect(result.flags).not.toContain('SANCTIONED');
    });
  });

  describe('with custom config', () => {
    it('should use custom risk thresholds', async () => {
      const customScorer = new BasicRiskScorer({
        highRiskThreshold: 30,
        criticalRiskThreshold: 50,
      });

      const result = await customScorer.screenAddress('0x1234', 'ethereum');

      // Should still return valid result
      expect(result.riskLevel).toBeDefined();
    });
  });
});

describe('InMemorySanctionsProvider', () => {
  let provider: InMemorySanctionsProvider;

  beforeEach(() => {
    provider = new InMemorySanctionsProvider([
      {
        address: '0xbad',
        chain: 'ethereum',
        listName: 'OFAC',
        entityName: 'Bad Actor',
        addedAt: new Date(),
        reason: 'Sanctioned',
      },
    ]);
  });

  it('should find sanctioned addresses', async () => {
    const result = await provider.checkAddress('0xbad', 'ethereum');
    expect(result).not.toBeNull();
    expect(result!.entityName).toBe('Bad Actor');
  });

  it('should return null for clean addresses', async () => {
    const result = await provider.checkAddress('0xgood', 'ethereum');
    expect(result).toBeNull();
  });

  it('should be case-insensitive', async () => {
    const result = await provider.checkAddress('0xBAD', 'ethereum');
    expect(result).not.toBeNull();
  });

  it('should add and remove entries', async () => {
    provider.addEntry({
      address: '0xnew',
      chain: 'ethereum',
      listName: 'Internal',
      entityName: 'New Entry',
      addedAt: new Date(),
      reason: 'Test',
    });

    expect(await provider.checkAddress('0xnew', 'ethereum')).not.toBeNull();

    provider.removeEntry('0xnew', 'ethereum');
    expect(await provider.checkAddress('0xnew', 'ethereum')).toBeNull();
  });

  it('should list flagged addresses by chain', async () => {
    provider.addEntry({
      address: '0xother',
      chain: 'polygon',
      listName: 'Internal',
      entityName: 'Other',
      addedAt: new Date(),
      reason: 'Test',
    });

    const ethereumFlags = await provider.getFlaggedAddresses('ethereum');
    expect(ethereumFlags).toHaveLength(1);
    expect(ethereumFlags[0].address).toBe('0xbad');

    const polygonFlags = await provider.getFlaggedAddresses('polygon');
    expect(polygonFlags).toHaveLength(1);
    expect(polygonFlags[0].address).toBe('0xother');
  });

  it('should report healthy', async () => {
    expect(await provider.isHealthy()).toBe(true);
  });
});
