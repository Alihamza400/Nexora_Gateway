import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChainalysisRiskScorer } from './chainalysis-risk-scorer.js';
import { TRMRiskScorer } from './trm-risk-scorer.js';
import { VelocityChecker } from './velocity-checker.js';
import { ComplianceOrchestrator } from './compliance-orchestrator.js';
import type { IRiskScorer, TransactionInfo } from '@crypto-gateway/shared';

// ─── Mock Risk Scorer ──────────────────────────────────────────────────

function createMockRiskScorer(overrides?: Partial<IRiskScorer>): IRiskScorer {
  return {
    screenAddress: vi.fn(async (address: string, chain: string) => ({
      address,
      chain,
      riskScore: 25,
      riskLevel: 'LOW' as const,
      flags: [],
      details: {
        sanctionsMatch: null,
        walletAge: 100,
        transactionCount: 50,
        totalVolume: 10000,
        knownAssociations: [],
        jurisdictionRisk: 0,
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 300000),
    })),
    screenTransaction: vi.fn(async (tx: TransactionInfo) => ({
      address: tx.from,
      chain: tx.chain,
      riskScore: 30,
      riskLevel: 'LOW' as const,
      flags: [],
      details: {
        sanctionsMatch: null,
        walletAge: 100,
        transactionCount: 50,
        totalVolume: 10000,
        knownAssociations: [],
        jurisdictionRisk: 0,
      },
      screenedAt: new Date(),
      expiresAt: new Date(Date.now() + 300000),
    })),
    getRiskScore: vi.fn(async () => 25),
    ...overrides,
  } as IRiskScorer;
}

// ─── ChainalysisRiskScorer Tests ──────────────────────────────────────

describe('ChainalysisRiskScorer', () => {
  let scorer: ChainalysisRiskScorer;

  beforeEach(() => {
    scorer = new ChainalysisRiskScorer({ apiKey: 'test-key' });
  });

  it('screens an address successfully', async () => {
    const result = await scorer.screenAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1');

    expect(result).toBeDefined();
    expect(result.address).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(result.chain).toBe('1');
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(result.riskLevel).toBeDefined();
    expect(result.flags).toBeDefined();
    expect(result.screenedAt).toBeDefined();
  });

  it('caches results', async () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const chain = '1';

    const result1 = await scorer.screenAddress(address, chain);
    const result2 = await scorer.screenAddress(address, chain);

    expect(result1.riskScore).toBe(result2.riskScore);
  });

  it('screens a transaction', async () => {
    const tx: TransactionInfo = {
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    };

    const result = await scorer.screenTransaction(tx);
    expect(result).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });

  it('gets risk category', async () => {
    const category = await scorer.getRiskCategory('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1');
    expect(['safe', 'low_risk', 'medium_risk', 'high_risk', 'severe_risk']).toContain(category);
  });

  it('checks if address is sanctioned', async () => {
    const isSanctioned = await scorer.isSanctioned('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1');
    expect(typeof isSanctioned).toBe('boolean');
  });

  it('handles API errors gracefully', async () => {
    // Should not throw, return safe default
    const result = await scorer.screenAddress('0xInvalidAddress', 'unknown');
    expect(result).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });
});

// ─── TRMRiskScorer Tests ──────────────────────────────────────────────

describe('TRMRiskScorer', () => {
  let scorer: TRMRiskScorer;

  beforeEach(() => {
    scorer = new TRMRiskScorer({ apiKey: 'test-key' });
  });

  it('screens an address successfully', async () => {
    const result = await scorer.screenAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1');

    expect(result).toBeDefined();
    expect(result.address).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it('gets risk rating', async () => {
    const rating = await scorer.getRiskRating('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1');
    expect(['no_risk', 'low_risk', 'medium_risk', 'high_risk']).toContain(rating);
  });

  it('gets exposure summary', async () => {
    const summary = await scorer.getExposureSummary('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1');

    expect(summary).toBeDefined();
    expect(summary.address).toBeDefined();
    expect(summary.riskScore).toBeGreaterThanOrEqual(0);
    expect(summary.exposureTypes).toBeDefined();
  });

  it('handles errors gracefully', async () => {
    const result = await scorer.screenAddress('0xInvalid', 'unknown');
    expect(result).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });
});

// ─── VelocityChecker Tests ────────────────────────────────────────────

describe('VelocityChecker', () => {
  let checker: VelocityChecker;

  beforeEach(() => {
    checker = new VelocityChecker();
  });

  it('checks velocity for a transaction', () => {
    const tx: TransactionInfo = {
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    };

    const result = checker.checkVelocity(tx);

    expect(result).toBeDefined();
    expect(result.exceeded).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.flags).toBeDefined();
    expect(result.details).toBeDefined();
  });

  it('detects velocity anomaly with many transactions', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    // Send many transactions in rapid succession
    for (let i = 0; i < 25; i++) {
      checker.checkVelocity({
        from: address,
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        amount: 1000,
        asset: 'USDC',
        chain: '1',
        timestamp: new Date(),
      });
    }

    const result = checker.checkVelocity({
      from: address,
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    });

    expect(result.exceeded).toBe(true);
    expect(result.details.transactionCount).toBeGreaterThan(20);
  });

  it('detects high volume', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    // Send high volume
    checker.checkVelocity({
      from: address,
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 90000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    });

    const result = checker.checkVelocity({
      from: address,
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 15000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    });

    expect(result.exceeded).toBe(true);
  });

  it('gets velocity history', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    checker.checkVelocity({
      from: address,
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    });

    const history = checker.getHistory(address, '1');
    expect(history.length).toBe(1);
  });

  it('clears velocity history', () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    checker.checkVelocity({
      from: address,
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    });

    checker.clearHistory(address, '1');
    const history = checker.getHistory(address, '1');
    expect(history.length).toBe(0);
  });
});

// ─── ComplianceOrchestrator Tests ─────────────────────────────────────

describe('ComplianceOrchestrator', () => {
  let orchestrator: ComplianceOrchestrator;
  let mockScorer: IRiskScorer;

  beforeEach(() => {
    mockScorer = createMockRiskScorer();
    orchestrator = new ComplianceOrchestrator(mockScorer);
  });

  it('screens intent creation', async () => {
    const result = await orchestrator.screenIntentCreation(
      'intent-1',
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '1',
      1000,
    );

    expect(result).toBeDefined();
    expect(result.intentId).toBe('intent-1');
    expect(result.sourceRisk).toBeDefined();
    expect(result.blocked).toBe(false);
    expect(result.screenedAt).toBeDefined();
  });

  it('blocks sanctioned addresses', async () => {
    const sanctionedScorer = createMockRiskScorer({
      screenAddress: vi.fn(async (address: string, chain: string) => ({
        address,
        chain,
        riskScore: 100,
        riskLevel: 'CRITICAL' as const,
        flags: ['SANCTIONED'] as any,
        details: {
          sanctionsMatch: { listName: 'OFAC', matchScore: 100, entityName: 'Test', entityDetails: {} },
          walletAge: 0,
          transactionCount: 0,
          totalVolume: 0,
          knownAssociations: [],
          jurisdictionRisk: 0,
        },
        screenedAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
      })),
    });

    const sanctionedOrchestrator = new ComplianceOrchestrator(sanctionedScorer);

    const result = await sanctionedOrchestrator.screenIntentCreation(
      'intent-2',
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '1',
      1000,
    );

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('sanctions');
  });

  it('screens deposit', async () => {
    const tx: TransactionInfo = {
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1000,
      asset: 'USDC',
      chain: '1',
      timestamp: new Date(),
    };

    const result = await orchestrator.screenDeposit('intent-3', tx);

    expect(result).toBeDefined();
    expect(result.intentId).toBe('intent-3');
    expect(result.sourceRisk).toBeDefined();
  });

  it('screens settlement', async () => {
    const result = await orchestrator.screenSettlement(
      'intent-4',
      '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      '1',
      1000,
    );

    expect(result).toBeDefined();
    expect(result.intentId).toBe('intent-4');
    expect(result.destinationRisk).toBeDefined();
  });

  it('logs audit entries', async () => {
    await orchestrator.screenIntentCreation(
      'intent-5',
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '1',
      1000,
    );

    const log = orchestrator.getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0]!.intentId).toBe('intent-5');
  });

  it('filters audit log', async () => {
    await orchestrator.screenIntentCreation('intent-6', '0xAddr1', '1', 1000);
    await orchestrator.screenIntentCreation('intent-7', '0xAddr2', '1', 2000);

    const log = orchestrator.getAuditLog({ intentId: 'intent-6' });
    expect(log.length).toBe(1);
    expect(log[0]!.intentId).toBe('intent-6');
  });

  it('gets statistics', async () => {
    await orchestrator.screenIntentCreation('intent-8', '0xAddr1', '1', 1000);
    await orchestrator.screenIntentCreation('intent-9', '0xAddr2', '1', 2000);

    const stats = orchestrator.getStats();
    expect(stats.totalScreenings).toBe(2);
    expect(stats.allowed).toBeGreaterThanOrEqual(0);
    expect(stats.blocked).toBeGreaterThanOrEqual(0);
  });

  it('requires KYC for large amounts', async () => {
    const result = await orchestrator.screenIntentCreation(
      'intent-10',
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '1',
      50000,
    );

    expect(result.kycRequired).toBe(true);
  });
});
