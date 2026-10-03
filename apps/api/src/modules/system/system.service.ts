import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthResponse, ReadinessCheck, ReadyResponse } from '@vrp/contracts';
import type { DatabaseHandle } from '@vrp/database';

import type { Env } from '../../config/env.schema';
import { DATABASE_HANDLE } from '../../database/database.module';
import { APP_VERSION, SERVICE_NAME } from '../../version';

const CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class SystemService {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Liveness: the process is up. Never touches the database. */
  health(): HealthResponse {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: APP_VERSION,
      environment: this.config.get('NODE_ENV', { infer: true }),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: can this process serve real requests right now? */
  async readiness(): Promise<ReadyResponse> {
    const sql = this.database.sql;
    const [database, postgis, migrations] = await Promise.all([
      this.probe(() => sql`select 1`),
      this.probe(async () => {
        const rows = await sql<{ extversion: string }[]>`
          select extversion from pg_extension where extname = 'postgis'
        `;
        if (rows.length === 0) throw new Error('PostGIS extension is not installed');
      }),
      this.probe(async () => {
        const rows = await sql<{ count: number }[]>`
          select count(*)::int as count from drizzle.__drizzle_migrations
        `;
        if ((rows[0]?.count ?? 0) === 0) throw new Error('No migrations have been applied');
      }),
    ]);
    const checks = { database, postgis, migrations };
    const ready = Object.values(checks).every((check) => check.status === 'up');
    return { status: ready ? 'ready' : 'not_ready', checks, timestamp: new Date().toISOString() };
  }

  private async probe(run: () => Promise<unknown>): Promise<ReadinessCheck> {
    const started = performance.now();
    try {
      await withTimeout(run(), CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: elapsed(started) };
    } catch (error) {
      return { status: 'down', latencyMs: elapsed(started), message: describeError(error) };
    }
  }
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Short, secret-free description of a failed probe. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-url]').slice(0, 200);
}
