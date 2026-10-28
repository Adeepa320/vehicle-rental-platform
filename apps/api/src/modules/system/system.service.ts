import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthResponse, ReadinessCheck, ReadyResponse } from '@vrp/contracts';
import type { DatabaseHandle } from '@vrp/database';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.schema';
import { DATABASE_HANDLE } from '../../database/database.module';
import { APP_VERSION, SERVICE_NAME } from '../../version';

const CHECK_TIMEOUT_MS = 3_000;

type ReadinessCheckName = 'database' | 'postgis' | 'migrations';

/**
 * The only text a public readiness response may carry for a failed check.
 * Driver errors name hosts, addresses and ports, so they go to the server log only.
 */
export const READINESS_PUBLIC_MESSAGES: Record<ReadinessCheckName, string> = {
  database: 'database unavailable',
  postgis: 'PostGIS unavailable',
  migrations: 'migration check unavailable',
};

@Injectable()
export class SystemService {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SystemService.name);
  }

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
      this.probe('database', () => sql`select 1`),
      this.probe('postgis', async () => {
        const rows = await sql<{ extversion: string }[]>`
          select extversion from pg_extension where extname = 'postgis'
        `;
        if (rows.length === 0) throw new Error('PostGIS extension is not installed');
      }),
      this.probe('migrations', async () => {
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

  private async probe(
    name: ReadinessCheckName,
    run: () => Promise<unknown>,
  ): Promise<ReadinessCheck> {
    const started = performance.now();
    try {
      await withTimeout(run(), CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: elapsed(started) };
    } catch (error) {
      // Operators see the cause in the server log (connection URLs still redacted); callers never do.
      this.logger.warn({ check: name, cause: describeError(error) }, 'Readiness check failed');
      return {
        status: 'down',
        latencyMs: elapsed(started),
        message: READINESS_PUBLIC_MESSAGES[name],
      };
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

/** Short description of a failed probe for the server log only: connection URLs (and their credentials) redacted. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-url]').slice(0, 200);
}
