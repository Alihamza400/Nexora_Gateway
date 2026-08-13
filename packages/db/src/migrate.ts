import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getClient } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Migration {
  name: string;
  up: string;
  down: string;
}

/**
 * Load all migration files from the migrations directory.
 * Files must be named like: 001_create_payment_intents.sql
 */
function loadMigrations(): Migration[] {
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((file) => {
    const content = readFileSync(join(migrationsDir, file), 'utf-8');
    const [up, down] = content.split('-- DOWN');
    return {
      name: file.replace('.sql', ''),
      up: up?.replace('-- UP', '').trim() || '',
      down: down?.trim() || '',
    };
  });
}

/**
 * Create the migrations tracking table if it doesn't exist.
 */
async function ensureMigrationsTable(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Get list of already-applied migrations.
 */
async function getAppliedMigrations(client: any): Promise<string[]> {
  const result = await client.query('SELECT name FROM schema_migrations ORDER BY id');
  return result.rows.map((r: any) => r.name);
}

/**
 * Run all pending migrations.
 */
export async function migrate(): Promise<void> {
  const client = await getClient();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const migrations = loadMigrations();

    for (const migration of migrations) {
      if (!applied.includes(migration.name)) {
        console.log(`📦 Running migration: ${migration.name}`);
        await client.query('BEGIN');
        try {
          await client.query(migration.up);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
          await client.query('COMMIT');
          console.log(`✅ Migration applied: ${migration.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`❌ Migration failed: ${migration.name}`, error);
          throw error;
        }
      }
    }

    console.log('🎉 All migrations applied successfully');
  } finally {
    client.release();
  }
}

// Run if executed directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
