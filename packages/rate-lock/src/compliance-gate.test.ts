/**
 * ComplianceGate Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ComplianceGate } from './compliance-gate.js';

import type { IRiskScorer, TransactionInfo, RiskResult } from '@crypto-gateway/shared';

// ─── Mock Risk Scorer ────────────────────────────────────────────────────────

function createMockScorer(
  riskScore: number,
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  flags: string[] = [],
): IRiskScorer {
  return {
    screenAddress: vi.fn().mockResolvedValue({
      address: '0x1234',
      chain: 'ethereum',
      riskScore,
      riskLevel,
      flags,
      details: {
        sanctionsMatch: null,
        walletAge: 0,
        transactionCount: 0,
        totalVolume: 0,
        knownAssociations: [],
        jurisdictionRisk: 0,
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    } as RiskResult),
    screenTransaction: vi.fn().mockResolvedValue({
      address: '0x1234',
      chain: 'ethereum',
      riskScore,
      riskLevel,
      flags,
      details: {
        sanctionsMatch: null,
        walletAge: 0,
        transactionCount: 0,
        totalVolume: 0,
        knownAssociations: [],
        jurisdictionRisk: 0,
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    } as RiskResult),
    getRiskScore: vi.fn().mockResolvedValue(riskScore),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ComplianceGate', () => {
  describe('checkAddress', () => {
    it('should allow low-risk addresses', async () => {
      const scorer = createMockScorer(20, 'LOW');
      const gate = new ComplianceGate(scorer);

      const result = await gate.checkAddress('0x1234', 'ethereum', 1000);

      expect(result.allowed).toBe(true);
      expect(result.riskAssessment.riskLevel).toBe('LOW');
    });

    it('should block critical-risk addresses', async () => {
      const scorer = createMockScorer(90, 'CRITICAL');
      const gate = new ComplianceGate(scorer);

      const result = await gate.checkAddress('0x1234', 'ethereum', 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('CRITICAL');
    });

    it('should block sanctioned addresses', async () => {
      const scorer = createMockScorer(100, 'CRITICAL', ['SANCTIONED']);
      const gate = new ComplianceGate(scorer);

      const result = await gate.checkAddress('0x1234', 'ethereum', 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('sanctions');
    });

    it('should block high-risk addresses with large amounts', async () => {
      const scorer = createMockScorer(70, 'HIGH');
      const gate = new ComplianceGate(scorer);

      const result = await gate.checkAddress('0x1234', 'ethereum', 100000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('High-risk');
    });

    it('should allow high-risk addresses with small amounts', async () => {
      const scorer = createMockScorer(70, 'HIGH');
      const gate = new ComplianceGate(scorer);

      const result = await gate.checkAddress('0x1234', 'ethereum', 1000);

      expect(result.allowed).toBe(true);
    });

    it('should block manually blocked addresses', async () => {
      const scorer = createMockScorer(10, 'LOW');
      const gate = new ComplianceGate(scorer);

      gate.blockAddress('0x1234');

      const result = await gate.checkAddress('0x1234', 'ethereum', 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('manually blocked');
    });

    it('should unblock addresses', async () => {
      const scorer = createMockScorer(10, 'LOW');
      const gate = new ComplianceGate(scorer);

      gate.blockAddress('0x1234');
      gate.unblockAddress('0x1234');

      const result = await gate.checkAddress('0x1234', 'ethereum', 1000);

      expect(result.allowed).toBe(true);
    });

    it('should block unsupported chains', async () => {
      const scorer = createMockScorer(10, 'LOW');
      const gate = new ComplianceGate(scorer);

      gate.blockChain('unsupported');

      const result = await gate.checkAddress('0x1234', 'unsupported', 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not supported');
    });
  });

  describe('checkTransaction', () => {
    it('should allow low-risk transactions', async () => {
      const scorer = createMockScorer(20, 'LOW');
      const gate = new ComplianceGate(scorer);

      const tx: TransactionInfo = {
        from: '0x1234',
        to: '0x5678',
        amount: 1000,
        asset: 'ETH',
        chain: 'ethereum',
        timestamp: new Date(),
      };

      const result = await gate.checkTransaction(tx);

      expect(result.allowed).toBe(true);
    });

    it('should block critical-risk transactions', async () => {
      const scorer = createMockScorer(90, 'CRITICAL');
      const gate = new ComplianceGate(scorer);

      const tx: TransactionInfo = {
        from: '0x1234',
        to: '0x5678',
        amount: 1000,
        asset: 'ETH',
        chain: 'ethereum',
        timestamp: new Date(),
      };

      const result = await gate.checkTransaction(tx);

      expect(result.allowed).toBe(false);
    });

    it('should block transactions with mixer association', async () => {
      const scorer = createMockScorer(60, 'HIGH', ['MIXER']);
      const gate = new ComplianceGate(scorer);

      const tx: TransactionInfo = {
        from: '0x1234',
        to: '0x5678',
        amount: 1000,
        asset: 'ETH',
        chain: 'ethereum',
        timestamp: new Date(),
      };

      const result = await gate.checkTransaction(tx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('mixer');
    });

    it('should block transactions with darknet association', async () => {
      const scorer = createMockScorer(60, 'HIGH', ['DARKNET']);
      const gate = new ComplianceGate(scorer);

      const tx: TransactionInfo = {
        from: '0x1234',
        to: '0x5678',
        amount: 1000,
        asset: 'ETH',
        chain: 'ethereum',
        timestamp: new Date(),
      };

      const result = await gate.checkTransaction(tx);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('darknet');
    });
  });

  describe('management methods', () => {
    it('should list blocked addresses', () => {
      const scorer = createMockScorer(10, 'LOW');
      const gate = new ComplianceGate(scorer);

      gate.blockAddress('0xaaa');
      gate.blockAddress('0xbbb');

      expect(gate.getBlockedAddresses()).toContain('0xaaa');
      expect(gate.getBlockedAddresses()).toContain('0xbbb');
    });

    it('should list blocked chains', () => {
      const scorer = createMockScorer(10, 'LOW');
      const gate = new ComplianceGate(scorer);

      gate.blockChain('chain1');
      gate.blockChain('chain2');

      expect(gate.getBlockedChains()).toContain('chain1');
      expect(gate.getBlockedChains()).toContain('chain2');
    });
  });
});
