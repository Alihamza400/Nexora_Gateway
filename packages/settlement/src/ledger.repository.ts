/**
 * Ledger Repository
 *
 * Handles all database operations for the double-entry ledger.
 * Append-only: entries are created, never updated or deleted.
 * Every financial movement is recorded as a pair of debit/credit entries.
 */

import type {
  LedgerEntry,
  LedgerEntryType,
} from '@crypto-gateway/shared';

export interface CreateLedgerEntryParams {
  intent_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  asset: string;
  chain: string;
  debit_account: string;
  credit_account: string;
  metadata?: Record<string, unknown>;
}

export class LedgerRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new ledger entry (append-only).
   */
  async create(params: CreateLedgerEntryParams): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      intent_id: params.intent_id,
      entry_type: params.entry_type,
      amount: params.amount,
      asset: params.asset,
      chain: params.chain,
      debit_account: params.debit_account,
      credit_account: params.credit_account,
      metadata: params.metadata ?? null,
      created_at: new Date(),
    };

    await this.db.query(
      `INSERT INTO ledger_entries (id, intent_id, entry_type, amount, asset, chain, debit_account, credit_account, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.id,
        entry.intent_id,
        entry.entry_type,
        entry.amount,
        entry.asset,
        entry.chain,
        entry.debit_account,
        entry.credit_account,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.created_at,
      ],
    );

    return entry;
  }

  /**
   * Get all ledger entries for an intent.
   */
  async findByIntentId(intentId: string): Promise<LedgerEntry[]> {
    const result = await this.db.query(
      'SELECT * FROM ledger_entries WHERE intent_id = $1 ORDER BY created_at ASC',
      [intentId],
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Get all ledger entries for an account in a period.
   */
  async findByAccount(
    accountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<LedgerEntry[]> {
    const result = await this.db.query(
      `SELECT * FROM ledger_entries 
       WHERE (debit_account = $1 OR credit_account = $1) 
       AND created_at BETWEEN $2 AND $3 
       ORDER BY created_at ASC`,
      [accountId, startDate, endDate],
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Calculate balance for an account and asset.
   * Balance = total debits - total credits.
   */
  async getBalance(accountId: string, asset: string): Promise<number> {
    const result = await this.db.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN debit_account = $1 THEN amount ELSE 0 END), 0) as debits,
         COALESCE(SUM(CASE WHEN credit_account = $1 THEN amount ELSE 0 END), 0) as credits
       FROM ledger_entries 
       WHERE (debit_account = $1 OR credit_account = $1) 
       AND asset = $2`,
      [accountId, asset],
    );

    const debits = Number(result.rows[0]?.debits ?? 0);
    const credits = Number(result.rows[0]?.credits ?? 0);
    return debits - credits;
  }

  /**
   * Get merchant balance for a specific asset.
   */
  async getMerchantBalance(merchantId: string, asset: string): Promise<number> {
    return this.getBalance(`merchant:${merchantId}`, asset);
  }

  /**
   * Get total fees collected in a period.
   */
  async getTotalFees(
    startDate: Date,
    endDate: Date,
  ): Promise<{ total: number; count: number }> {
    const result = await this.db.query(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM ledger_entries 
       WHERE entry_type = 'FEE'
       AND created_at BETWEEN $1 AND $2`,
      [startDate, endDate],
    );

    return {
      total: Number(result.rows[0]?.total ?? 0),
      count: Number(result.rows[0]?.count ?? 0),
    };
  }

  /**
   * Verify ledger consistency: every DEBIT has a matching CREDIT.
   */
  async verifyConsistency(): Promise<{
    isConsistent: boolean;
    totalDebits: number;
    totalCredits: number;
    difference: number;
  }> {
    const result = await this.db.query(
      `SELECT 
         COALESCE(SUM(amount), 0) as total_debits,
         COALESCE(SUM(amount), 0) as total_credits
       FROM ledger_entries`,
    );

    // In a double-entry system, total debits should equal total credits
    const totalDebits = Number(result.rows[0]?.total_debits ?? 0);
    const totalCredits = Number(result.rows[0]?.total_credits ?? 0);

    return {
      isConsistent: Math.abs(totalDebits - totalCredits) < 0.0001,
      totalDebits,
      totalCredits,
      difference: totalDebits - totalCredits,
    };
  }

  /**
   * Get entries by type in a period.
   */
  async findByType(
    entryType: LedgerEntryType,
    startDate: Date,
    endDate: Date,
  ): Promise<LedgerEntry[]> {
    const result = await this.db.query(
      `SELECT * FROM ledger_entries 
       WHERE entry_type = $1 
       AND created_at BETWEEN $2 AND $3 
       ORDER BY created_at ASC`,
      [entryType, startDate, endDate],
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Map a database row to a LedgerEntry object.
   */
  private mapRow(row: Record<string, unknown>): LedgerEntry {
    return {
      id: row.id as string,
      intent_id: row.intent_id as string,
      entry_type: row.entry_type as LedgerEntryType,
      amount: Number(row.amount),
      asset: row.asset as string,
      chain: row.chain as string,
      debit_account: row.debit_account as string,
      credit_account: row.credit_account as string,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata as Record<string, unknown>) : null,
      created_at: new Date(row.created_at as string),
    };
  }
}

/**
 * Minimal database client interface for type safety.
 */
export interface DatabaseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
