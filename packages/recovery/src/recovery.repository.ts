import type {
  RecoveryCase,
  RecoveryCaseType,
  RecoveryStatus,
  ResolutionAction,
} from '@crypto-gateway/shared';

/**
 * Database client interface for type safety.
 */
export interface DatabaseClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Parameters for creating a new recovery case.
 */
export interface CreateRecoveryCaseParams {
  related_intent_id: string | null;
  case_type: RecoveryCaseType;
  customer_address: string;
  customer_chain: string;
  intended_chain: string;
  asset: string;
  amount: number;
  tx_hash: string | null;
}

/**
 * Parameters for updating a recovery case.
 */
export interface UpdateRecoveryCaseParams {
  status?: RecoveryStatus;
  resolution_action?: ResolutionAction;
  resolution_tx_hash?: string | null;
  resolved_at?: Date | null;
}

/**
 * Recovery Repository
 *
 * Handles all database operations for recovery cases.
 * Uses optimistic locking via updated_at to prevent concurrent modifications.
 * Append-only pattern: cases are created and updated, never deleted.
 */
export class RecoveryRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new recovery case.
   */
  async create(params: CreateRecoveryCaseParams): Promise<RecoveryCase> {
    const now = new Date();
    const id = crypto.randomUUID();

    const result = await this.db.query(
      `INSERT INTO recovery_cases (id, related_intent_id, case_type, status, customer_address, customer_chain, intended_chain, asset, amount, tx_hash, created_at, updated_at)
       VALUES ($1, $2, $3, 'DETECTED', $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        params.related_intent_id,
        params.case_type,
        params.customer_address,
        params.customer_chain,
        params.intended_chain,
        params.asset,
        params.amount,
        params.tx_hash,
        now,
        now,
      ],
    );

    return this.mapRow(result.rows[0]!);
  }

  /**
   * Update a recovery case. Uses optimistic locking via updated_at.
   */
  async update(id: string, params: UpdateRecoveryCaseParams): Promise<RecoveryCase> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Recovery case not found: ${id}`);
    }

    const now = new Date();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }
    if (params.resolution_action !== undefined) {
      updates.push(`resolution_action = $${paramIndex++}`);
      values.push(params.resolution_action);
    }
    if (params.resolution_tx_hash !== undefined) {
      updates.push(`resolution_tx_hash = $${paramIndex++}`);
      values.push(params.resolution_tx_hash);
    }
    if (params.resolved_at !== undefined) {
      updates.push(`resolved_at = $${paramIndex++}`);
      values.push(params.resolved_at);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);

    values.push(id);

    const result = await this.db.query(
      `UPDATE recovery_cases SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Recovery case not found after update: ${id}`);
    }
    return this.mapRow(row);
  }

  /**
   * Find a recovery case by ID.
   */
  async findById(id: string): Promise<RecoveryCase | null> {
    const result = await this.db.query(
      'SELECT * FROM recovery_cases WHERE id = $1',
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Find recovery cases by type and status.
   */
  async findByTypeAndStatus(
    caseType: RecoveryCaseType,
    status: RecoveryStatus,
  ): Promise<RecoveryCase[]> {
    const result = await this.db.query(
      'SELECT * FROM recovery_cases WHERE case_type = $1 AND status = $2 ORDER BY created_at ASC',
      [caseType, status],
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Find recovery cases for a specific intent.
   */
  async findByIntentId(intentId: string): Promise<RecoveryCase[]> {
    const result = await this.db.query(
      'SELECT * FROM recovery_cases WHERE related_intent_id = $1 ORDER BY created_at DESC',
      [intentId],
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Find recovery cases for a customer address.
   */
  async findByCustomerAddress(address: string, chain: string): Promise<RecoveryCase[]> {
    const result = await this.db.query(
      'SELECT * FROM recovery_cases WHERE customer_address = $1 AND customer_chain = $2 ORDER BY created_at DESC',
      [address, chain],
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Find stuck transactions (pending for too long).
   */
  async findStuckTransactions(maxAgeMs: number): Promise<RecoveryCase[]> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await this.db.query(
      `SELECT * FROM recovery_cases
       WHERE case_type = 'STUCK' AND status IN ('DETECTED', 'VERIFYING')
       AND created_at < $1
       ORDER BY created_at ASC`,
      [cutoff],
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Get recovery case statistics for monitoring.
   */
  async getStats(): Promise<Record<RecoveryCaseType, Record<RecoveryStatus, number>>> {
    const result = await this.db.query(
      `SELECT case_type, status, COUNT(*) as count
       FROM recovery_cases
       GROUP BY case_type, status`,
    );

    const stats: Record<string, Record<string, number>> = {};
    for (const row of result.rows) {
      const caseType = row.case_type as string;
      const status = row.status as string;
      if (!stats[caseType]) stats[caseType] = {};
      stats[caseType][status] = Number(row.count);
    }
    return stats as Record<RecoveryCaseType, Record<RecoveryStatus, number>>;
  }

  /**
   * Map a database row to a RecoveryCase object.
   */
  private mapRow(row: Record<string, unknown>): RecoveryCase {
    return {
      id: row.id as string,
      related_intent_id: row.related_intent_id as string | null,
      case_type: row.case_type as RecoveryCaseType,
      status: row.status as RecoveryStatus,
      customer_address: row.customer_address as string,
      customer_chain: row.customer_chain as string,
      intended_chain: row.intended_chain as string,
      asset: row.asset as string,
      amount: Number(row.amount),
      tx_hash: row.tx_hash as string | null,
      resolution_action: row.resolution_action as ResolutionAction | null,
      resolution_tx_hash: row.resolution_tx_hash as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      resolved_at: row.resolved_at ? new Date(row.resolved_at as string) : null,
    };
  }
}
