/**
 * Settlement Repository
 *
 * Handles all database operations for settlements.
 * Uses optimistic locking via version field to prevent concurrent modifications.
 * Append-only pattern: settlements are created and updated, never deleted.
 */

import type {
  Settlement,
  SettlementStatus,
} from '@crypto-gateway/shared';

export interface CreateSettlementParams {
  intent_id: string;
  merchant_id: string;
  amount: number;
  asset: string;
  chain: string;
  destination_address: string;
}

export interface UpdateSettlementParams {
  status?: SettlementStatus;
  tx_hash?: string;
  completed_at?: Date;
}

export class SettlementRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new settlement record.
   */
  async create(params: CreateSettlementParams): Promise<Settlement> {
    const now = new Date();
    const settlement: Settlement = {
      id: crypto.randomUUID(),
      intent_id: params.intent_id,
      merchant_id: params.merchant_id,
      amount: params.amount,
      asset: params.asset,
      chain: params.chain,
      destination_address: params.destination_address,
      status: 'PENDING',
      tx_hash: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    await this.db.query(
      `INSERT INTO settlements (id, intent_id, merchant_id, amount, asset, chain, destination_address, status, tx_hash, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        settlement.id,
        settlement.intent_id,
        settlement.merchant_id,
        settlement.amount,
        settlement.asset,
        settlement.chain,
        settlement.destination_address,
        settlement.status,
        settlement.tx_hash,
        settlement.created_at,
        settlement.updated_at,
        settlement.completed_at,
      ],
    );

    return settlement;
  }

  /**
   * Update a settlement record. Uses optimistic locking via updated_at.
   */
  async update(id: string, params: UpdateSettlementParams): Promise<Settlement> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Settlement not found: ${id}`);
    }

    const now = new Date();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }
    if (params.tx_hash !== undefined) {
      updates.push(`tx_hash = $${paramIndex++}`);
      values.push(params.tx_hash);
    }
    if (params.completed_at !== undefined) {
      updates.push(`completed_at = $${paramIndex++}`);
      values.push(params.completed_at);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);

    values.push(id);

    const result = await this.db.query(
      `UPDATE settlements SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Settlement not found after update: ${id}`);
    }
    return this.mapRow(row);
  }

  /**
   * Find a settlement by ID.
   */
  async findById(id: string): Promise<Settlement | null> {
    const result = await this.db.query(
      'SELECT * FROM settlements WHERE id = $1',
      [id],
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Find settlement by intent ID.
   */
  async findByIntentId(intentId: string): Promise<Settlement | null> {
    const result = await this.db.query(
      'SELECT * FROM settlements WHERE intent_id = $1',
      [intentId],
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Find all settlements for a merchant.
   */
  async findByMerchantId(merchantId: string): Promise<Settlement[]> {
    const result = await this.db.query(
      'SELECT * FROM settlements WHERE merchant_id = $1 ORDER BY created_at DESC',
      [merchantId],
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Find pending settlements (for retry processing).
   */
  async findPending(): Promise<Settlement[]> {
    const result = await this.db.query(
      "SELECT * FROM settlements WHERE status IN ('PENDING', 'RETRYING') ORDER BY created_at ASC",
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Find failed settlements eligible for retry.
   */
  async findRetryable(maxRetries: number = 3): Promise<Settlement[]> {
    const result = await this.db.query(
      `SELECT * FROM settlements 
       WHERE status = 'FAILED' 
       AND (metadata->>'retry_count')::int < $1
       ORDER BY created_at ASC`,
      [maxRetries],
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Get total settled amount for a merchant in a period.
   */
  async getMerchantSettledTotal(
    merchantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ total: number; count: number }> {
    const result = await this.db.query(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM settlements 
       WHERE merchant_id = $1 
       AND status = 'COMPLETED'
       AND completed_at BETWEEN $2 AND $3`,
      [merchantId, startDate, endDate],
    );

    return {
      total: Number(result.rows[0]?.total ?? 0),
      count: Number(result.rows[0]?.count ?? 0),
    };
  }

  /**
   * Map a database row to a Settlement object.
   */
  private mapRow(row: Record<string, unknown>): Settlement {
    return {
      id: row.id as string,
      intent_id: row.intent_id as string,
      merchant_id: row.merchant_id as string,
      amount: Number(row.amount),
      asset: row.asset as string,
      chain: row.chain as string,
      destination_address: row.destination_address as string,
      status: row.status as SettlementStatus,
      tx_hash: row.tx_hash as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      completed_at: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }
}

/**
 * Minimal database client interface for type safety.
 */
export interface DatabaseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
