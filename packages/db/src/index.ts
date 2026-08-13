/**
 * Database Package
 * Migrations, seeds, and database connection utilities.
 */

export { Pool } from 'pg';
export type { PoolConfig, PoolClient, QueryResult } from 'pg';
export { getPool, getClient, query, transaction, closePool, healthCheck } from './connection.js';
