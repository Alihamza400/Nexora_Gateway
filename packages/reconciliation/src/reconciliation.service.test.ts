import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationService } from './reconciliation.service.js';

// ─── Mock Database Client ────────────────────────────────────────────────

function createMockDb() {
  const store: Array<Record<string, unknown>> = [];
  let idCounter = 0;

  return {
    store,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Handle INSERT for reconciliation_records
      if (sql.startsWith('INSERT INTO reconciliation_records')) {
        idCounter++;
        const entry: Record<string, unknown> = {
          id: params?.[0] ?? `recon-${idCounter}`,
          period: params?.[1],
          start_date: params?.[2],
          end_date: params?.[3],
          status: params?.[4],
          total_intents: params?.[5],
          total_settled: params?.[6],
          total_pending: params?.[7],
          total_failed: params?.[8],
          total_discrepancies: 0,
          created_at: params?.[9] ?? new Date().toISOString(),
          completed_at: null,
        };
        store.push(entry);
        return { rows: [entry] };
      }

      // Handle UPDATE reconciliation_records
      if (sql.startsWith('UPDATE reconciliation_records')) {
        const idParam = params?.[params.length - 1];
        const entry = store.find((e) => e.id === idParam);
        if (entry) {
          if (params?.[0]) entry.status = params[0];
          if (params?.[1] !== undefined) entry.total_discrepancies = params[1];
          if (params?.[2]) entry.completed_at = params[2];
        }
        return { rows: entry ? [entry] : [] };
      }

      // Handle SELECT reconciliation_records by ID
      if (sql.includes('FROM reconciliation_records') && sql.includes('WHERE id = $1')) {
        const idParam = params?.[0];
        const entry = store.find((e) => e.id === idParam);
        return { rows: entry ? [entry] : [] };
      }

      // Handle SELECT reconciliation_records by date range
      if (sql.includes('FROM reconciliation_records') && sql.includes('start_date >= $1')) {
        return { rows: store.filter((e) => e.period) };
      }

      // Handle COUNT queries for intent counts
      if (sql.includes('COUNT(*)') && sql.includes('payment_intents')) {
        return { rows: [{ total: '10', settled: '8', pending: '1', failed: '1' }] };
      }

      // Handle settlement queries
      if (sql.includes('FROM settlements')) {
        return { rows: [] };
      }

      // Handle ledger entry queries
      if (sql.includes('FROM ledger_entries')) {
        return { rows: [] };
      }

      // Handle missing settlements check
      if (sql.includes('payment_intents') && sql.includes('LEFT JOIN settlements')) {
        return { rows: [] };
      }

      // Handle discrepancy queries
      if (sql.includes('FROM discrepancies')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('ReconciliationService', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let service: ReconciliationService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new ReconciliationService(mockDb as any);
  });

  // ─── Run Reconciliation ──────────────────────────────────────────────

  describe('runReconciliation', () => {
    it('runs daily reconciliation successfully', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const result = await service.runReconciliation('DAILY', startDate, endDate);

      expect(result).toBeDefined();
      expect(result.record).toBeDefined();
      expect(result.discrepancies).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('creates reconciliation record with correct period', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const result = await service.runReconciliation('DAILY', startDate, endDate);

      expect(result.record.period).toBe('DAILY');
      expect(result.record.startDate).toEqual(startDate);
      expect(result.record.endDate).toEqual(endDate);
    });

    it('marks as COMPLETED when no discrepancies', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const result = await service.runReconciliation('DAILY', startDate, endDate);

      expect(result.record.status).toBe('COMPLETED');
      expect(result.passed).toBe(true);
    });

    it('marks as DISCREPANCY_FOUND when discrepancies exist', async () => {
      // Add discrepancy to mock
      mockDb.store.push({
        id: 'discrepancy-1',
        reconciliation_record_id: 'recon-1',
        type: 'MISSING_SETTLEMENT',
        severity: 'HIGH',
        intent_id: 'intent-1',
        description: 'Missing settlement',
        expected_value: 'Settlement exists',
        actual_value: 'No settlement',
        difference: null,
        metadata: {},
        detected_at: new Date().toISOString(),
        resolved_at: null,
        resolution: null,
      });

      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      // Override the check to return discrepancies
      mockDb.query.mockImplementation(async (sql: string) => {
        if (sql.includes('LEFT JOIN settlements') && sql.includes('payment_intents')) {
          return { rows: [{ intent_id: 'intent-1' }] };
        }
        if (sql.startsWith('INSERT INTO reconciliation_records')) {
          const entry = {
            id: 'recon-1',
            period: 'DAILY',
            start_date: new Date('2025-01-01'),
            end_date: new Date('2025-01-02'),
            status: 'IN_PROGRESS',
            total_intents: 10,
            total_settled: 8,
            total_pending: 1,
            total_failed: 1,
            total_discrepancies: 0,
            created_at: new Date().toISOString(),
            completed_at: null,
          };
          mockDb.store.push(entry);
          return { rows: [entry] };
        }
        if (sql.startsWith('UPDATE reconciliation_records')) {
          const entry = mockDb.store.find((e) => e.id === 'recon-1');
          if (entry) {
            entry.status = 'DISCREPANCY_FOUND';
            entry.total_discrepancies = 1;
          }
          return { rows: [entry] };
        }
        if (sql.includes('FROM reconciliation_records') && sql.includes('WHERE id')) {
          const entry = mockDb.store.find((e) => e.id === 'recon-1');
          return { rows: entry ? [entry] : [] };
        }
        if (sql.includes('COUNT(*)') && sql.includes('payment_intents')) {
          return { rows: [{ total: '10', settled: '8', pending: '1', failed: '1' }] };
        }
        return { rows: [] };
      });

      const result = await service.runReconciliation('DAILY', startDate, endDate);

      expect(result.record.status).toBe('DISCREPANCY_FOUND');
      expect(result.passed).toBe(false);
      expect(result.discrepancies.length).toBeGreaterThan(0);
    });

    it('supports hourly reconciliation', async () => {
      const startDate = new Date('2025-01-01T00:00:00');
      const endDate = new Date('2025-01-01T01:00:00');

      const result = await service.runReconciliation('HOURLY', startDate, endDate);

      expect(result.record.period).toBe('HOURLY');
    });

    it('supports weekly reconciliation', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-08');

      const result = await service.runReconciliation('WEEKLY', startDate, endDate);

      expect(result.record.period).toBe('WEEKLY');
    });

    it('supports monthly reconciliation', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-02-01');

      const result = await service.runReconciliation('MONTHLY', startDate, endDate);

      expect(result.record.period).toBe('MONTHLY');
    });
  });

  // ─── Get Record ──────────────────────────────────────────────────────

  describe('getRecord', () => {
    it('returns record by ID', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const result = await service.runReconciliation('DAILY', startDate, endDate);
      const record = await service.getRecord(result.record.id);

      expect(record).not.toBeNull();
      expect(record?.id).toBe(result.record.id);
    });

    it('returns null for non-existent record', async () => {
      const record = await service.getRecord('nonexistent');
      expect(record).toBeNull();
    });
  });

  // ─── Get Records ────────────────────────────────────────────────────

  describe('getRecords', () => {
    it('returns records for date range', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      await service.runReconciliation('DAILY', startDate, endDate);

      const records = await service.getRecords(startDate, endDate);
      expect(records.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Financial Report ────────────────────────────────────────────────

  describe('generateFinancialReport', () => {
    it('generates a financial report', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const report = await service.generateFinancialReport('DAILY', startDate, endDate);

      expect(report).toBeDefined();
      expect(report.id).toBeDefined();
      expect(report.period).toBe('DAILY');
      expect(report.startDate).toEqual(startDate);
      expect(report.endDate).toEqual(endDate);
      expect(report.summary).toBeDefined();
      expect(report.byChain).toBeDefined();
      expect(report.byMerchant).toBeDefined();
      expect(report.fxGainLossDetails).toBeDefined();
    });

    it('includes correct financial summary', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const report = await service.generateFinancialReport('DAILY', startDate, endDate);

      expect(report.summary.totalSettledUsd).toBeDefined();
      expect(report.summary.totalFeesUsd).toBeDefined();
      expect(report.summary.settlementSuccessRate).toBeDefined();
    });
  });

  // ─── Export ──────────────────────────────────────────────────────────

  describe('exportData', () => {
    it('exports data as JSON', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const result = await service.runReconciliation('DAILY', startDate, endDate);
      const json = await service.exportData(result.record.id, 'JSON');

      expect(json).toBeDefined();
      const parsed = JSON.parse(json);
      expect(parsed.record).toBeDefined();
      expect(parsed.discrepancies).toBeDefined();
    });

    it('exports data as CSV', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-02');

      const result = await service.runReconciliation('DAILY', startDate, endDate);
      const csv = await service.exportData(result.record.id, 'CSV');

      expect(csv).toBeDefined();
      expect(csv).toContain('Type,Severity,Intent ID');
    });

    it('throws for non-existent record', async () => {
      await expect(service.exportData('nonexistent', 'JSON')).rejects.toThrow('not found');
    });
  });

  // ─── Error Handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('handles database errors gracefully', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        service.runReconciliation('DAILY', new Date('2025-01-01'), new Date('2025-01-02')),
      ).rejects.toThrow('DB connection lost');
    });
  });
});
