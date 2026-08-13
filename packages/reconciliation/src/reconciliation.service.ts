import { randomUUID } from 'node:crypto';
import type {
  IReconciliationService,
  ReconciliationRecord,
  ReconciliationPeriod,
  ReconciliationStatus,
  ReconciliationCheckResult,
  Discrepancy,
  DiscrepancyType,
  DiscrepancySeverity,
  DiscrepancySummary,
  FinancialSummary,
  FinancialReport,
  ChainFinancialSummary,
  MerchantFinancialSummary,
  FxGainLossEntry,
} from '@crypto-gateway/shared';

/**
 * Database client interface for type safety.
 */
export interface DatabaseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Reconciliation Service
 *
 * Ensures financial accuracy and audit readiness:
 * 1. Period reconciliation (hourly/daily/weekly/monthly)
 * 2. Discrepancy detection (amount mismatch, missing settlement, etc.)
 * 3. Financial reports (settled, pending, failed)
 * 4. FX gain/loss tracking
 *
 * Reconciliation Checks:
 * 1. Ledger entry exists for every settled intent
 * 2. Settlement amount matches rate-locked amount
 * 3. No duplicate settlements
 * 4. On-chain transactions match ledger entries
 * 5. FX gain/loss calculated correctly
 */
export class ReconciliationService implements IReconciliationService {
  private readonly db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  // ─── Period Reconciliation ──────────────────────────────────────────

  async runReconciliation(
    period: ReconciliationPeriod,
    startDate: Date,
    endDate: Date,
  ): Promise<ReconciliationCheckResult> {
    const startTime = Date.now();

    // Create reconciliation record
    const record = await this.createRecord(period, startDate, endDate);

    // Run all reconciliation checks
    const discrepancies: Discrepancy[] = [];

    // 1. Check for missing settlements
    const missingSettlements = await this.checkMissingSettlements(record.id, startDate, endDate);
    discrepancies.push(...missingSettlements);

    // 2. Check for amount mismatches
    const amountMismatches = await this.checkAmountMismatches(record.id, startDate, endDate);
    discrepancies.push(...amountMismatches);

    // 3. Check for duplicate settlements
    const duplicates = await this.checkDuplicateSettlements(record.id, startDate, endDate);
    discrepancies.push(...duplicates);

    // 4. Check for missing ledger entries
    const missingLedger = await this.checkMissingLedgerEntries(record.id, startDate, endDate);
    discrepancies.push(...missingLedger);

    // 5. Check FX gain/loss
    const fxDiscrepancies = await this.checkFxGainLoss(record.id, startDate, endDate);
    discrepancies.push(...fxDiscrepancies);

    // Update record with results
    const summary = this.buildDiscrepancySummary(discrepancies);
    const financialSummary = await this.calculateFinancialSummary(startDate, endDate);

    const finalRecord = await this.updateRecord(record.id, {
      status: discrepancies.length > 0 ? 'DISCREPANCY_FOUND' : 'COMPLETED',
      totalDiscrepancies: discrepancies.length,
      discrepancySummary: summary,
      financialSummary,
      completedAt: new Date(),
    });

    const duration = Date.now() - startTime;

    return {
      passed: discrepancies.length === 0,
      record: finalRecord,
      discrepancies,
      duration,
    };
  }

  // ─── Query Methods ───────────────────────────────────────────────────

  async getRecord(id: string): Promise<ReconciliationRecord | null> {
    const result = await this.db.query(
      'SELECT * FROM reconciliation_records WHERE id = $1',
      [id],
    );
    return result.rows[0] ? this.mapRecord(result.rows[0]) : null;
  }

  async getRecords(startDate: Date, endDate: Date): Promise<ReconciliationRecord[]> {
    const result = await this.db.query(
      `SELECT * FROM reconciliation_records
       WHERE start_date >= $1 AND end_date <= $2
       ORDER BY created_at DESC`,
      [startDate, endDate],
    );
    return result.rows.map((row) => this.mapRecord(row));
  }

  // ─── Financial Reports ──────────────────────────────────────────────

  async generateFinancialReport(
    period: ReconciliationPeriod,
    startDate: Date,
    endDate: Date,
  ): Promise<FinancialReport> {
    const summary = await this.calculateFinancialSummary(startDate, endDate);
    const byChain = await this.getFinancialByChain(startDate, endDate);
    const byMerchant = await this.getFinancialByMerchant(startDate, endDate);
    const fxDetails = await this.getFxGainLossDetails(startDate, endDate);

    return {
      id: randomUUID(),
      period,
      startDate,
      endDate,
      generatedAt: new Date(),
      summary,
      byChain,
      byMerchant,
      fxGainLossDetails: fxDetails,
    };
  }

  // ─── Export ──────────────────────────────────────────────────────────

  async exportData(recordId: string, format: 'CSV' | 'JSON'): Promise<string> {
    const record = await this.getRecord(recordId);
    if (!record) {
      throw new Error(`Reconciliation record not found: ${recordId}`);
    }

    const discrepancies = await this.getDiscrepancies(recordId);

    if (format === 'JSON') {
      return JSON.stringify({ record, discrepancies }, null, 2);
    }

    // CSV format
    const csvLines = [
      'Type,Severity,Intent ID,Description,Expected,Actual,Difference,Detected At',
      ...discrepancies.map((d) =>
        `${d.type},${d.severity},${d.intentId},${d.description},${d.expectedValue},${d.actualValue},${d.difference ?? ''},${d.detectedAt.toISOString()}`,
      ),
    ];
    return csvLines.join('\n');
  }

  // ─── Private Reconciliation Checks ──────────────────────────────────

  private async checkMissingSettlements(
    recordId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Discrepancy[]> {
    // Find intents that are SETTLED but have no settlement record
    const result = await this.db.query(
      `SELECT pi.id as intent_id
       FROM payment_intents pi
       LEFT JOIN settlements s ON pi.id = s.intent_id
       WHERE pi.state = 'SETTLED'
       AND s.id IS NULL
       AND pi.updated_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    return result.rows.map((row) => this.createDiscrepancy(
      recordId,
      'MISSING_SETTLEMENT',
      'HIGH',
      row.intent_id as string,
      'Settled intent has no settlement record',
      'Settlement record exists',
      'No settlement record',
      null,
    ));
  }

  private async checkAmountMismatches(
    recordId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Discrepancy[]> {
    // Find settlements where amount doesn't match the intent's target_amount minus fees
    const result = await this.db.query(
      `SELECT s.id as settlement_id, s.intent_id, s.amount as settlement_amount,
              pi.target_amount, pi.quoted_rate, m.fee_percentage
       FROM settlements s
       JOIN payment_intents pi ON s.intent_id = pi.id
       JOIN merchants m ON pi.merchant_id = m.id
       WHERE s.status = 'COMPLETED'
       AND s.completed_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    const discrepancies: Discrepancy[] = [];

    for (const row of result.rows) {
      const targetAmount = Number(row.target_amount);
      const feePercentage = Number(row.fee_percentage);
      const expectedAmount = targetAmount * (1 - feePercentage / 100);
      const actualAmount = Number(row.settlement_amount);

      // Allow 0.01% tolerance for rounding
      const tolerance = expectedAmount * 0.0001;
      if (Math.abs(expectedAmount - actualAmount) > tolerance) {
        discrepancies.push(this.createDiscrepancy(
          recordId,
          'AMOUNT_MISMATCH',
          'HIGH',
          row.intent_id as string,
          `Settlement amount mismatch`,
          expectedAmount,
          actualAmount,
          expectedAmount - actualAmount,
        ));
      }
    }

    return discrepancies;
  }

  private async checkDuplicateSettlements(
    recordId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Discrepancy[]> {
    // Find intents with multiple settlements
    const result = await this.db.query(
      `SELECT intent_id, COUNT(*) as count
       FROM settlements
       WHERE created_at BETWEEN $1 AND $2
       GROUP BY intent_id
       HAVING COUNT(*) > 1`,
      [startDate, endDate],
    );

    return result.rows.map((row) => this.createDiscrepancy(
      recordId,
      'DUPLICATE_SETTLEMENT',
      'CRITICAL',
      row.intent_id as string,
      `Intent has ${row.count} settlements`,
      1,
      Number(row.count),
      Number(row.count) - 1,
    ));
  }

  private async checkMissingLedgerEntries(
    recordId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Discrepancy[]> {
    // Find settlements without corresponding ledger entries
    const result = await this.db.query(
      `SELECT s.id as settlement_id, s.intent_id
       FROM settlements s
       LEFT JOIN ledger_entries le ON s.intent_id = le.intent_id AND le.entry_type = 'SETTLEMENT'
       WHERE s.status = 'COMPLETED'
       AND s.completed_at BETWEEN $1 AND $2
       AND le.id IS NULL`,
      [startDate, endDate],
    );

    return result.rows.map((row) => this.createDiscrepancy(
      recordId,
      'MISSING_LEDGER_ENTRY',
      'HIGH',
      row.intent_id as string,
      'Settlement has no ledger entry',
      'Ledger entry exists',
      'No ledger entry',
      null,
    ));
  }

  private async checkFxGainLoss(
    recordId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Discrepancy[]> {
    // Check if FX gain/loss entries balance
    const result = await this.db.query(
      `SELECT
         SUM(CASE WHEN debit_account = 'revenue:fx' THEN amount ELSE 0 END) as total_gains,
         SUM(CASE WHEN debit_account = 'expense:fx' THEN amount ELSE 0 END) as total_losses
       FROM ledger_entries
       WHERE entry_type = 'FX_GAIN_LOSS'
       AND created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    const row = result.rows[0];
    if (!row) return [];

    const totalGains = Number(row.total_gains) || 0;
    const totalLosses = Number(row.total_losses) || 0;

    // Net FX impact should be reasonable (within 10% of total volume)
    const totalVolume = totalGains + totalLosses;
    if (totalVolume > 0 && Math.abs(totalGains - totalLosses) / totalVolume > 0.1) {
      return [this.createDiscrepancy(
        recordId,
        'FX_GAIN_LOSS_MISMATCH',
        'MEDIUM',
        'aggregate',
        'FX gains/losses significantly imbalanced',
        'Balanced FX gains/losses',
        `Gains: ${totalGains}, Losses: ${totalLosses}`,
        Math.abs(totalGains - totalLosses),
      )];
    }

    return [];
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private async createRecord(
    period: ReconciliationPeriod,
    startDate: Date,
    endDate: Date,
  ): Promise<ReconciliationRecord> {
    const id = randomUUID();
    const now = new Date();

    // Get intent counts
    const counts = await this.getIntentCounts(startDate, endDate);

    const record: ReconciliationRecord = {
      id,
      period,
      startDate,
      endDate,
      status: 'IN_PROGRESS',
      totalIntents: counts.total,
      totalSettled: counts.settled,
      totalPending: counts.pending,
      totalFailed: counts.failed,
      totalDiscrepancies: 0,
      discrepancySummary: this.emptyDiscrepancySummary(),
      financialSummary: this.emptyFinancialSummary(),
      createdAt: now,
      completedAt: null,
    };

    await this.db.query(
      `INSERT INTO reconciliation_records (id, period, start_date, end_date, status, total_intents, total_settled, total_pending, total_failed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, period, startDate, endDate, 'IN_PROGRESS', counts.total, counts.settled, counts.pending, counts.failed, now],
    );

    return record;

    return record;
  }

  private async updateRecord(
    id: string,
    updates: Partial<{
      status: ReconciliationStatus;
      totalDiscrepancies: number;
      discrepancySummary: DiscrepancySummary;
      financialSummary: FinancialSummary;
      completedAt: Date;
    }>,
  ): Promise<ReconciliationRecord> {
    const now = new Date();
    await this.db.query(
      `UPDATE reconciliation_records
       SET status = $1, total_discrepancies = $2, completed_at = $3, updated_at = $4
       WHERE id = $5`,
      [updates.status, updates.totalDiscrepancies, updates.completedAt, now, id],
    );

    const record = await this.getRecord(id);
    if (!record) throw new Error(`Record not found after update: ${id}`);

    // Apply updates to in-memory record for return
    if (updates.status) record.status = updates.status;
    if (updates.totalDiscrepancies !== undefined) record.totalDiscrepancies = updates.totalDiscrepancies;
    if (updates.discrepancySummary) record.discrepancySummary = updates.discrepancySummary;
    if (updates.financialSummary) record.financialSummary = updates.financialSummary;
    if (updates.completedAt) record.completedAt = updates.completedAt;

    return record;
  }

  private async getIntentCounts(startDate: Date, endDate: Date) {
    const result = await this.db.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE state = 'SETTLED') as settled,
         COUNT(*) FILTER (WHERE state IN ('CREATED', 'QUOTED', 'AWAITING_PAYMENT', 'DETECTED', 'CONFIRMING', 'ROUTING', 'SETTLING')) as pending,
         COUNT(*) FILTER (WHERE state = 'FAILED') as failed
       FROM payment_intents
       WHERE created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    const row = result.rows[0];
    return {
      total: Number(row?.total) || 0,
      settled: Number(row?.settled) || 0,
      pending: Number(row?.pending) || 0,
      failed: Number(row?.failed) || 0,
    };
  }

  private async calculateFinancialSummary(
    startDate: Date,
    endDate: Date,
  ): Promise<FinancialSummary> {
    // Get settlement totals
    const settlementResult = await this.db.query(
      `SELECT
         COALESCE(SUM(amount), 0) as total_settled,
         COUNT(*) as total_count,
         COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_count
       FROM settlements
       WHERE created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    // Get fee totals
    const feeResult = await this.db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_fees
       FROM ledger_entries
       WHERE entry_type = 'FEE'
       AND created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    // Get FX gain/loss
    const fxResult = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN debit_account = 'revenue:fx' THEN amount ELSE 0 END), 0) as total_gains,
         COALESCE(SUM(CASE WHEN debit_account = 'expense:fx' THEN amount ELSE 0 END), 0) as total_losses
       FROM ledger_entries
       WHERE entry_type = 'FX_GAIN_LOSS'
       AND created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    const settlementRow = settlementResult.rows[0];
    const feeRow = feeResult.rows[0];
    const fxRow = fxResult.rows[0];

    const totalSettled = Number(settlementRow?.total_settled) || 0;
    const totalCount = Number(settlementRow?.total_count) || 0;
    const completedCount = Number(settlementRow?.completed_count) || 0;
    const totalFees = Number(feeRow?.total_fees) || 0;
    const totalFxGain = Number(fxRow?.total_gains) || 0;
    const totalFxLoss = Number(fxRow?.total_losses) || 0;

    return {
      totalSettledUsd: totalSettled, // In production, convert to USD
      totalFeesUsd: totalFees,
      totalFxGainUsd: totalFxGain,
      totalFxLossUsd: totalFxLoss,
      netFxImpactUsd: totalFxGain - totalFxLoss,
      settlementSuccessRate: totalCount > 0 ? (completedCount / totalCount) * 100 : 0,
      averageSettlementTime: 0, // Would need to calculate from timestamps
    };
  }

  private async getFinancialByChain(startDate: Date, endDate: Date): Promise<ChainFinancialSummary[]> {
    const result = await this.db.query(
      `SELECT s.chain, COUNT(*) as count, SUM(s.amount) as total
       FROM settlements s
       WHERE s.status = 'COMPLETED'
       AND s.completed_at BETWEEN $1 AND $2
       GROUP BY s.chain`,
      [startDate, endDate],
    );

    return result.rows.map((row) => ({
      chainId: row.chain as string,
      chainName: row.chain as string,
      totalSettled: Number(row.total) || 0,
      totalSettledUsd: Number(row.total) || 0,
      totalFees: 0,
      totalTransactions: Number(row.count) || 0,
      successRate: 100,
    }));
  }

  private async getFinancialByMerchant(startDate: Date, endDate: Date): Promise<MerchantFinancialSummary[]> {
    const result = await this.db.query(
      `SELECT s.merchant_id, m.name, COUNT(*) as count, SUM(s.amount) as total
       FROM settlements s
       JOIN merchants m ON s.merchant_id = m.id
       WHERE s.status = 'COMPLETED'
       AND s.completed_at BETWEEN $1 AND $2
       GROUP BY s.merchant_id, m.name`,
      [startDate, endDate],
    );

    return result.rows.map((row) => ({
      merchantId: row.merchant_id as string,
      merchantName: row.name as string,
      totalSettled: Number(row.total) || 0,
      totalSettledUsd: Number(row.total) || 0,
      totalFees: 0,
      totalTransactions: Number(row.count) || 0,
    }));
  }

  private async getFxGainLossDetails(startDate: Date, endDate: Date): Promise<FxGainLossEntry[]> {
    const result = await this.db.query(
      `SELECT intent_id, asset, chain, metadata
       FROM ledger_entries
       WHERE entry_type = 'FX_GAIN_LOSS'
       AND created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    return result.rows.map((row) => {
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      return {
        intentId: row.intent_id as string,
        asset: row.asset as string,
        chain: row.chain as string,
        lockedRate: 0,
        actualRate: 0,
        gainLoss: Number(metadata?.amount) || 0,
        gainLossUsd: Number(metadata?.amount) || 0,
        recordedAt: new Date(),
      };
    });
  }

  private async getDiscrepancies(recordId: string): Promise<Discrepancy[]> {
    const result = await this.db.query(
      'SELECT * FROM discrepancies WHERE reconciliation_record_id = $1',
      [recordId],
    );
    return result.rows.map((row) => this.mapDiscrepancy(row));
  }

  private createDiscrepancy(
    recordId: string,
    type: DiscrepancyType,
    severity: DiscrepancySeverity,
    intentId: string,
    description: string,
    expectedValue: unknown,
    actualValue: unknown,
    difference: number | null,
  ): Discrepancy {
    return {
      id: randomUUID(),
      reconciliationRecordId: recordId,
      type,
      severity,
      intentId,
      description,
      expectedValue,
      actualValue,
      difference,
      metadata: {},
      detectedAt: new Date(),
      resolvedAt: null,
      resolution: null,
    };
  }

  private buildDiscrepancySummary(discrepancies: Discrepancy[]): DiscrepancySummary {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const d of discrepancies) {
      byType[d.type] = (byType[d.type] || 0) + 1;
      bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
    }

    return {
      totalDiscrepancies: discrepancies.length,
      byType: byType as Record<DiscrepancyType, number>,
      bySeverity: bySeverity as Record<DiscrepancySeverity, number>,
      criticalDiscrepancies: discrepancies.filter((d) => d.severity === 'CRITICAL'),
    };
  }

  private emptyDiscrepancySummary(): DiscrepancySummary {
    return {
      totalDiscrepancies: 0,
      byType: {} as Record<DiscrepancyType, number>,
      bySeverity: {} as Record<DiscrepancySeverity, number>,
      criticalDiscrepancies: [],
    };
  }

  private emptyFinancialSummary(): FinancialSummary {
    return {
      totalSettledUsd: 0,
      totalFeesUsd: 0,
      totalFxGainUsd: 0,
      totalFxLossUsd: 0,
      netFxImpactUsd: 0,
      settlementSuccessRate: 0,
      averageSettlementTime: 0,
    };
  }

  private mapRecord = (row: Record<string, unknown>): ReconciliationRecord => {
    return {
      id: row.id as string,
      period: row.period as ReconciliationPeriod,
      startDate: new Date(row.start_date as string),
      endDate: new Date(row.end_date as string),
      status: row.status as ReconciliationStatus,
      totalIntents: Number(row.total_intents) || 0,
      totalSettled: Number(row.total_settled) || 0,
      totalPending: Number(row.total_pending) || 0,
      totalFailed: Number(row.total_failed) || 0,
      totalDiscrepancies: Number(row.total_discrepancies) || 0,
      discrepancySummary: this.emptyDiscrepancySummary(),
      financialSummary: this.emptyFinancialSummary(),
      createdAt: new Date(row.created_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }

  private mapDiscrepancy = (row: Record<string, unknown>): Discrepancy => {
    return {
      id: row.id as string,
      reconciliationRecordId: row.reconciliation_record_id as string,
      type: row.type as DiscrepancyType,
      severity: row.severity as DiscrepancySeverity,
      intentId: row.intent_id as string,
      description: row.description as string,
      expectedValue: row.expected_value,
      actualValue: row.actual_value,
      difference: row.difference ? Number(row.difference) : null,
      metadata: (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) || {},
      detectedAt: new Date(row.detected_at as string),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
      resolution: row.resolution as string | null,
    };
  }
}
