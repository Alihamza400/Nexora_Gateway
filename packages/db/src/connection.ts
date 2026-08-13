import { Pool, PoolConfig, PoolClient } from 'pg';

let globalPool: Pool | null = null;

export interface DatabaseConfig extends PoolConfig {}

/**
 * Get or create the global database connection pool.
 * Uses singleton pattern to reuse connections across the application.
 */
export function getPool(config?: DatabaseConfig): Pool {
  if (!globalPool) {
    globalPool = new Pool({
      host: process.env['DATABASE_HOST'] || config?.host || 'localhost',
      port: parseInt(process.env['DATABASE_PORT'] || String(config?.port || '5432'), 10),
      database: process.env['DATABASE_NAME'] || config?.database || 'crypto_gateway',
      user: process.env['DATABASE_USER'] || config?.user || 'postgres',
      password: process.env['DATABASE_PASSWORD'] || config?.password || 'postgres',
      min: config?.min || 2,
      max: config?.max || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return globalPool;
}

/**
 * Get a client from the pool for transactions.
 * Remember to release the client when done.
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

/**
 * Execute a query using the pool.
 */
export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

/**
 * Execute a function within a database transaction.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the global pool. Call this on shutdown.
 */
export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
}

/**
 * Check database connectivity.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT 1 as ok');
    return result.rows[0]?.['ok'] === 1;
  } catch {
    return false;
  }
}
