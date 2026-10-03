import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadRootEnv, requireEnv } from './env';

/** Resolves to `packages/database/drizzle` from both `src/` and `dist/`. */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'drizzle');

/** Arbitrary constant; every migrator takes the same session-level advisory lock. */
const MIGRATION_LOCK_KEY = 7_420_001;

/**
 * Applies every pending SQL migration in `drizzle/` (tracked in
 * `drizzle.__drizzle_migrations`). Idempotent: already-applied migrations are
 * skipped. Safe to run concurrently (several API instances or test suites
 * starting at once): a PostgreSQL advisory lock serialises runners, and the
 * later ones find nothing left to apply. Rollback policy: migrations are
 * forward-only; to undo, write a new migration (see docs/DATABASE_DESIGN.md §2).
 */
export async function runMigrations(
  url: string,
  log: (message: string) => void = () => {},
): Promise<void> {
  // max: 1 so the advisory lock and the migration statements share one session.
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    // `CREATE EXTENSION IF NOT EXISTS` raises a NOTICE when it already exists.
    onnotice: () => {},
    connection: { application_name: 'vehicle-rental-migrate' },
  });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      const db = drizzle(sql);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      log(`Migrations applied from ${MIGRATIONS_FOLDER}`);
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  loadRootEnv();
  runMigrations(requireEnv('DATABASE_URL'), (message) => console.warn(message))
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
