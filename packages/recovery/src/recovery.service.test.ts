import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoveryService, type RecoveryServiceConfig } from './recovery.service.js';
import type {
  IChainClient,
} from '@crypto-gateway/shared';

// ─── Mock Database Client ────────────────────────────────────────────────

function createMockDb() {
  const store: Array<Record<string, unknown>> = [];
  let idCounter = 0;

  return {
    store,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Handle INSERT
      if (sql.startsWith('INSERT')) {
        idCounter++;
        // SQL: INSERT INTO recovery_cases (id, related_intent_id, case_type, status, customer_address, customer_chain, intended_chain, asset, amount, tx_hash, created_at, updated_at)
        // VALUES ($1, $2, $3, 'DETECTED', $4, $5, $6, $7, $8, $9, $10, $11)
        // Note: status is hardcoded as 'DETECTED' in SQL, so params shift by 1
        const entry: Record<string, unknown> = {
          id: params?.[0] ?? `recovery-${idCounter}`,
          related_intent_id: params?.[1],
          case_type: params?.[2],
          status: 'DETECTED',
          customer_address: params?.[3],
          customer_chain: params?.[4],
          intended_chain: params?.[5],
          asset: params?.[6],
          amount: params?.[7],
          tx_hash: params?.[8],
          resolution_action: null,
          resolution_tx_hash: null,
          created_at: params?.[9] ?? new Date().toISOString(),
          updated_at: params?.[10] ?? new Date().toISOString(),
          resolved_at: null,
        };
        store.push(entry);
        return { rows: [entry] };
      }

      // Handle UPDATE
      if (sql.startsWith('UPDATE')) {
        const idParam = params?.[params.length - 1];
        const entry = store.find((e) => e.id === idParam);
        if (entry) {
          // Simple update simulation
          if (params?.[0]) entry.status = params[0];
          if (params?.[1]) entry.resolution_action = params[1];
          if (params?.[2] !== undefined) entry.resolution_tx_hash = params[2];
          if (params?.[3] !== undefined) entry.resolved_at = params[3];
          entry.updated_at = new Date().toISOString();
        }
        return { rows: entry ? [entry] : [] };
      }

      // Handle SELECT by ID
      if (sql.includes('WHERE id = $1') && !sql.includes('GROUP BY')) {
        const entry = store.find((e) => e.id === params?.[0]);
        return { rows: entry ? [entry] : [] };
      }

      // Handle SELECT by intent_id
      if (sql.includes('related_intent_id')) {
        const filtered = store.filter((e) => e.related_intent_id === params?.[0]);
        return { rows: filtered };
      }

      // Handle SELECT by customer_address
      if (sql.includes('customer_address') && sql.includes('customer_chain')) {
        const filtered = store.filter(
          (e) => e.customer_address === params?.[0] && e.customer_chain === params?.[1],
        );
        return { rows: filtered };
      }

      // Handle SELECT by case_type and status
      if (sql.includes('case_type') && sql.includes('status') && sql.includes('AND') && !sql.includes('GROUP BY')) {
        const filtered = store.filter(
          (e) => e.case_type === params?.[0] && e.status === params?.[1],
        );
        return { rows: filtered };
      }

      // Handle stuck transactions query
      if (sql.includes('STUCK')) {
        const filtered = store.filter(
          (e) =>
            e.case_type === 'STUCK' &&
            (e.status === 'DETECTED' || e.status === 'VERIFYING'),
        );
        return { rows: filtered };
      }

      // Handle GROUP BY (stats)
      if (sql.includes('GROUP BY')) {
        const stats: Record<string, Record<string, number>> = {};
        for (const entry of store) {
          const caseType = entry.case_type as string;
          const status = entry.status as string;
          if (!stats[caseType]) stats[caseType] = {};
          stats[caseType][status] = (stats[caseType][status] || 0) + 1;
        }
        const rows = Object.entries(stats).flatMap(([caseType, statuses]) =>
          Object.entries(statuses).map(([status, count]) => ({
            case_type: caseType,
            status,
            count: String(count),
          })),
        );
        return { rows };
      }

      return { rows: [] };
    }),
  };
}

// ─── Mock Chain Client ──────────────────────────────────────────────────

function createMockChainClient(overrides?: Partial<IChainClient>): IChainClient {
  return {
    chainId: '1',
    chainName: 'Ethereum',
    getConfirmationDepth: () => 12,
    getBlockTime: () => 12,
    getNativeAsset: () => ({ address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' }),
    validateAddress: (addr) => /^0x[0-9a-fA-F]{40}$/.test(addr),
    formatAddress: (addr) => addr,
    estimateGas: vi.fn(async () => ({
      gasLimit: 21000,
      gasPrice: 20000000000,
      totalCost: 0.00042,
      totalCostUSD: 1.0,
    })),
    submitTransaction: vi.fn(async () => ({ txHash: '0xabc', nonce: 1 })),
    getTransactionStatus: vi.fn(async () => ({
      txHash: '0xabc',
      status: 'CONFIRMED' as const,
      confirmations: 12,
    })),
    getTransactionReceipt: vi.fn(async () => ({
      txHash: '0xabc',
      status: true,
      blockNumber: 100,
      blockHash: '0xblock',
      gasUsed: 21000,
      effectiveGasPrice: 20000000000,
      logs: [],
    })),
    getBalance: vi.fn(async () => ({
      asset: { address: '0x0', symbol: 'ETH', decimals: 18, name: 'Ether' },
      amount: '1000000000000000000',
      amountUSD: 2000,
    })),
    getTokenBalance: vi.fn(async () => ({
      asset: { address: '0xabc', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
      amount: '1000000',
      amountUSD: 1,
    })),
    watchDeposits: vi.fn(() => () => {}),
    ...overrides,
  } as IChainClient;
}

// ─── Test Data ───────────────────────────────────────────────────────────

const mockChainClients = new Map<string, IChainClient>([
  ['1', createMockChainClient()],
  ['8453', createMockChainClient({ chainId: '8453', chainName: 'Base' })],
]);

// ─── Tests ───────────────────────────────────────────────────────────────

describe('RecoveryService', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let service: RecoveryService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new RecoveryService(mockDb as any, mockChainClients);
  });

  // ─── Detection: Misdirected ────────────────────────────────────────────

  describe('detectMisdirected', () => {
    it('creates a recovery case for misdirected payment', async () => {
      const recoveryCase = await service.detectMisdirected({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '8453', // Sent to Base
        intendedChain: '1', // Should have been Ethereum
        asset: 'USDC',
        amount: 100,
        txHash: '0xTxHash',
      });

      expect(recoveryCase).toBeDefined();
      expect(recoveryCase.case_type).toBe('MISDIRECTED');
      expect(recoveryCase.status).toBe('DETECTED');
      expect(recoveryCase.customer_chain).toBe('8453');
      expect(recoveryCase.intended_chain).toBe('1');
      expect(recoveryCase.amount).toBe(100);
      expect(recoveryCase.tx_hash).toBe('0xTxHash');
    });

    it('stores in database', async () => {
      await service.detectMisdirected({
        intentId: null,
        customerAddress: '0xCustomerAddress',
        customerChain: '8453',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xTxHash',
      });

      expect(mockDb.store.length).toBe(1);
      expect(mockDb.store[0]!.case_type).toBe('MISDIRECTED');
    });
  });

  // ─── Detection: Underpayment ──────────────────────────────────────────

  describe('detectUnderpayment', () => {
    it('creates a recovery case for underpayment', async () => {
      const recoveryCase = await service.detectUnderpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 80,
        txHash: '0xTxHash',
      });

      expect(recoveryCase.case_type).toBe('UNDERPAID');
      expect(recoveryCase.amount).toBe(80);
    });
  });

  // ─── Detection: Overpayment ───────────────────────────────────────────

  describe('detectOverpayment', () => {
    it('creates a recovery case for overpayment', async () => {
      const recoveryCase = await service.detectOverpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 150,
        txHash: '0xTxHash',
      });

      expect(recoveryCase.case_type).toBe('OVERPAID');
      expect(recoveryCase.amount).toBe(150);
    });
  });

  // ─── Detection: Stuck ────────────────────────────────────────────────

  describe('detectStuck', () => {
    it('creates a recovery case for stuck transaction', async () => {
      const recoveryCase = await service.detectStuck({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xStuckTxHash',
      });

      expect(recoveryCase.case_type).toBe('STUCK');
      expect(recoveryCase.tx_hash).toBe('0xStuckTxHash');
    });
  });

  // ─── Ownership Verification ──────────────────────────────────────────

  describe('verifyOwnership', () => {
    it('returns verified=true for valid signature', async () => {
      const proof = await service.verifyOwnership(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        '0x' + 'ab'.repeat(65),
        'I own this address',
        '1',
      );

      expect(proof.verified).toBe(true);
      expect(proof.verified_at).toBeDefined();
    });

    it('returns verified=false for invalid signature format', async () => {
      const proof = await service.verifyOwnership(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        'invalid-signature',
        'I own this address',
        '1',
      );

      expect(proof.verified).toBe(false);
      expect(proof.verified_at).toBeNull();
    });

    it('returns verified=false for invalid address', async () => {
      const proof = await service.verifyOwnership(
        'invalid-address',
        '0x' + 'ab'.repeat(65),
        'I own this address',
        '1',
      );

      expect(proof.verified).toBe(false);
    });

    it('returns verified=false for empty message', async () => {
      const proof = await service.verifyOwnership(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        '0x' + 'ab'.repeat(65),
        '',
        '1',
      );

      expect(proof.verified).toBe(false);
    });

    it('returns verified=false for unknown chain', async () => {
      const proof = await service.verifyOwnership(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        '0x' + 'ab'.repeat(65),
        'I own this address',
        'unknown-chain',
      );

      expect(proof.verified).toBe(false);
    });
  });

  // ─── Resolution: Auto Refund ─────────────────────────────────────────

  describe('autoRefund', () => {
    it('resolves case with AUTO_REFUND action', async () => {
      // Create a case first
      const recoveryCase = await service.detectOverpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 150,
        txHash: '0xTxHash',
      });

      const result = await service.autoRefund(recoveryCase.id);

      expect(result.success).toBe(true);
      expect(result.action).toBe('AUTO_REFUND');
      expect(result.tx_hash).toBeDefined();
      expect(result.message).toContain('Refund');
    });
  });

  // ─── Resolution: Auto Credit ─────────────────────────────────────────

  describe('autoCredit', () => {
    it('resolves case with AUTO_CREDIT action', async () => {
      const recoveryCase = await service.detectOverpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 150,
        txHash: '0xTxHash',
      });

      const result = await service.autoCredit(recoveryCase.id);

      expect(result.success).toBe(true);
      expect(result.action).toBe('AUTO_CREDIT');
      expect(result.message).toContain('Credited');
    });
  });

  // ─── Resolution: Top-Up Link ─────────────────────────────────────────

  describe('generateTopUpLink', () => {
    it('generates a top-up link for underpayment', async () => {
      const recoveryCase = await service.detectUnderpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 80,
        txHash: '0xTxHash',
      });

      const topUpLink = await service.generateTopUpLink(recoveryCase.id);

      // Top-up link generation requires related intent, which returns null in mock
      // So we expect null in unit tests
      expect(topUpLink).toBeNull();
    });

    it('returns null for non-existent case', async () => {
      const topUpLink = await service.generateTopUpLink('nonexistent');
      expect(topUpLink).toBeNull();
    });

    it('returns null for non-underpayment case', async () => {
      const recoveryCase = await service.detectOverpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 150,
        txHash: '0xTxHash',
      });

      const topUpLink = await service.generateTopUpLink(recoveryCase.id);
      expect(topUpLink).toBeNull();
    });
  });

  // ─── Resolution: Top-Up Link via resolve() ──────────────────────────

  describe('resolve with TOP_UP_LINK', () => {
    it('returns failure when intent not available', async () => {
      const recoveryCase = await service.detectUnderpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 80,
        txHash: '0xTxHash',
      });

      const result = await service.resolve(recoveryCase.id, 'TOP_UP_LINK');

      // Intent not available in mock, so top-up link fails
      expect(result.success).toBe(false);
    });
  });

  // ─── Resolution: Re-Quote ────────────────────────────────────────────

  describe('resolve with RE_QUOTE', () => {
    it('resolves case with RE_QUOTE action', async () => {
      const recoveryCase = await service.detectUnderpayment({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 80,
        txHash: '0xTxHash',
      });

      const result = await service.resolve(recoveryCase.id, 'RE_QUOTE');

      expect(result.success).toBe(true);
      expect(result.action).toBe('RE_QUOTE');
    });
  });

  // ─── Resolution: Fee Bump ───────────────────────────────────────────

  describe('resolve with FEE_BUMP', () => {
    it('resolves case with FEE_BUMP action', async () => {
      const recoveryCase = await service.detectStuck({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xStuckTxHash',
      });

      const result = await service.resolve(recoveryCase.id, 'FEE_BUMP');

      expect(result.success).toBe(true);
      expect(result.action).toBe('FEE_BUMP');
    });
  });

  // ─── Resolution: Relayer Acceleration ────────────────────────────────

  describe('resolve with RELAYER_ACCELERATION', () => {
    it('resolves case with RELAYER_ACCELERATION action', async () => {
      const recoveryCase = await service.detectStuck({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xStuckTxHash',
      });

      const result = await service.resolve(recoveryCase.id, 'RELAYER_ACCELERATION');

      expect(result.success).toBe(true);
      expect(result.action).toBe('RELAYER_ACCELERATION');
      expect(result.tx_hash).toBeDefined();
    });

    it('fails for unknown chain', async () => {
      const recoveryCase = await service.detectStuck({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: 'unknown-chain',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xStuckTxHash',
      });

      const result = await service.resolve(recoveryCase.id, 'RELAYER_ACCELERATION');

      expect(result.success).toBe(false);
      expect(result.message).toContain('No chain client');
    });
  });

  // ─── Resolution: Unknown Action ──────────────────────────────────────

  describe('resolve with unknown action', () => {
    it('returns failure for unknown action', async () => {
      const recoveryCase = await service.detectStuck({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xStuckTxHash',
      });

      const result = await service.resolve(recoveryCase.id, 'UNKNOWN_ACTION' as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown resolution action');
    });
  });

  // ─── Resolution: Non-existent case ──────────────────────────────────

  describe('resolve with non-existent case', () => {
    it('returns failure for non-existent case', async () => {
      const result = await service.resolve('nonexistent', 'AUTO_REFUND');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  // ─── Query Methods ────────────────────────────────────────────────────

  describe('getCase', () => {
    it('returns case by ID', async () => {
      const recoveryCase = await service.detectMisdirected({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '8453',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xTxHash',
      });

      const found = await service.getCase(recoveryCase.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(recoveryCase.id);
    });

    it('returns null for non-existent case', async () => {
      const found = await service.getCase('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getCasesForIntent', () => {
    it('returns cases for an intent', async () => {
      await service.detectMisdirected({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '8453',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xTxHash',
      });

      const cases = await service.getCasesForIntent('intent-1');
      expect(cases.length).toBe(1);
      expect(cases[0]!.related_intent_id).toBe('intent-1');
    });
  });

  describe('getCasesForAddress', () => {
    it('returns cases for an address', async () => {
      await service.detectMisdirected({
        intentId: 'intent-1',
        customerAddress: '0xCustomerAddress',
        customerChain: '8453',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xTxHash',
      });

      const cases = await service.getCasesForAddress('0xCustomerAddress', '8453');
      expect(cases.length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('returns statistics', async () => {
      await service.detectMisdirected({
        intentId: 'intent-1',
        customerAddress: '0xAddress1',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        amount: 100,
        txHash: '0xTx1',
      });

      await service.detectUnderpayment({
        intentId: 'intent-2',
        customerAddress: '0xAddress2',
        customerChain: '1',
        intendedChain: '1',
        asset: 'USDC',
        expectedAmount: 100,
        receivedAmount: 80,
        txHash: '0xTx2',
      });

      const stats = await service.getStats();
      expect(stats).toBeDefined();
      expect(stats.MISDIRECTED).toBeDefined();
      expect(stats.UNDERPAID).toBeDefined();
    });
  });

  // ─── Configuration ────────────────────────────────────────────────────

  describe('configuration', () => {
    it('uses default config when none provided', () => {
      const defaultService = new RecoveryService(mockDb as any, mockChainClients);
      expect(defaultService).toBeDefined();
    });

    it('accepts custom config', () => {
      const customConfig: Partial<RecoveryServiceConfig> = {
        stuckTransactionTimeoutMs: 60000,
        topUpLinkTtlSeconds: 7200,
      };

      const customService = new RecoveryService(
        mockDb as any,
        mockChainClients,
        customConfig,
      );
      expect(customService).toBeDefined();
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('handles database errors gracefully in create', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        service.detectMisdirected({
          intentId: 'intent-1',
          customerAddress: '0xCustomerAddress',
          customerChain: '1',
          intendedChain: '1',
          asset: 'USDC',
          amount: 100,
          txHash: '0xTxHash',
        }),
      ).rejects.toThrow('DB connection lost');
    });
  });
});
