import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/** The transaction object passed to `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything a repository method can run queries on: the root database or an open transaction. */
export type DatabaseExecutor = Database | Transaction;

export interface DatabaseHandle {
  /** Drizzle query builder bound to the full schema. */
  db: Database;
  /** Underlying postgres.js client for raw/tagged-template SQL. */
  sql: Sql;
  /** Closes the pool. Safe to call more than once. */
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  url: string;
  /** Pool size. Keep small: managed Postgres providers cap connections. */
  max?: number;
  connectTimeoutSeconds?: number;
  /** Shown in `pg_stat_activity`; helps tell API, worker and scripts apart. */
  applicationName?: string;
}

/**
 * Creates a lazily-connecting database handle. No connection is opened until
 * the first query, so construction never throws for an unreachable server;
 * readiness checks surface that instead.
 */
export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const sql = postgres(options.url, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 5,
    idle_timeout: 30,
    connection: { application_name: options.applicationName ?? 'vehicle-rental' },
  });
  const db = drizzle(sql, { schema });
  let closed = false;
  return {
    db,
    sql,
    close: async () => {
      if (closed) return;
      closed = true;
      await sql.end({ timeout: 5 });
    },
  };
}
