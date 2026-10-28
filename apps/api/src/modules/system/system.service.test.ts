import type { ConfigService } from '@nestjs/config';
import { ReadyResponseSchema } from '@vrp/contracts';
import type { DatabaseHandle } from '@vrp/database';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.schema';
import { READINESS_PUBLIC_MESSAGES, SystemService } from './system.service';

// What a managed-database driver error can look like: host, address, port and a connection URL.
const LEAKY_HOST = 'ep-leak-canary-123456.ap-southeast-1.aws.neon.tech';
const LEAKY_ERROR = `getaddrinfo ENOTFOUND ${LEAKY_HOST} (10.20.30.40:5432) while connecting to postgresql://vrp_staging:leak-password@${LEAKY_HOST}:5432/vrp_staging`;
const FORBIDDEN = [
  LEAKY_HOST,
  'neon.tech',
  '10.20.30.40',
  '5432',
  'ENOTFOUND',
  'postgresql://',
  'vrp_staging',
  'leak-password',
];

type Warning = { fields: Record<string, unknown>; message: string };

function makeService(failing: (query: string) => boolean) {
  const sql = (strings: TemplateStringsArray) => {
    const query = strings.join('?');
    if (failing(query)) return Promise.reject(new Error(LEAKY_ERROR));
    if (query.includes('pg_extension')) return Promise.resolve([{ extversion: '3.5.2' }]);
    if (query.includes('__drizzle_migrations')) return Promise.resolve([{ count: 22 }]);
    return Promise.resolve([{ '?column?': 1 }]);
  };
  const warnings: Warning[] = [];
  const logger = {
    setContext: () => {},
    warn: (fields: Record<string, unknown>, message: string) => warnings.push({ fields, message }),
  } as unknown as PinoLogger;
  const config = { get: () => 'production' } as unknown as ConfigService<Env, true>;
  const service = new SystemService({ sql } as unknown as DatabaseHandle, config, logger);
  return { service, warnings };
}

describe('SystemService.readiness — public failure messages', () => {
  it('reports every failed check with a generic message and no infrastructure detail', async () => {
    const { service } = makeService(() => true);
    const result = await service.readiness();

    expect(ReadyResponseSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe('not_ready');
    expect(result.checks.database).toMatchObject({
      status: 'down',
      message: 'database unavailable',
    });
    expect(result.checks.postgis).toMatchObject({ status: 'down', message: 'PostGIS unavailable' });
    expect(result.checks.migrations).toMatchObject({
      status: 'down',
      message: 'migration check unavailable',
    });
    const body = JSON.stringify(result);
    for (const fragment of FORBIDDEN) expect(body).not.toContain(fragment);
  });

  it('keeps each check independent: only the failing one is down, with its own generic message', async () => {
    const { service } = makeService((query) => query.includes('__drizzle_migrations'));
    const result = await service.readiness();

    expect(result.status).toBe('not_ready');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.postgis.status).toBe('up');
    expect(result.checks.migrations).toMatchObject({
      status: 'down',
      message: READINESS_PUBLIC_MESSAGES.migrations,
    });
    for (const fragment of FORBIDDEN) expect(JSON.stringify(result)).not.toContain(fragment);
  });

  it('reports ready with no message when every check succeeds', async () => {
    const { service, warnings } = makeService(() => false);
    const result = await service.readiness();

    expect(result.status).toBe('ready');
    for (const check of Object.values(result.checks)) {
      expect(check.status).toBe('up');
      expect(check.message).toBeUndefined();
    }
    expect(warnings).toHaveLength(0);
  });

  it('keeps the operational cause in the server log, with the connection URL redacted', async () => {
    const { service, warnings } = makeService(() => true);
    await service.readiness();

    expect(warnings.map((w) => w.fields.check).sort()).toEqual([
      'database',
      'migrations',
      'postgis',
    ]);
    for (const warning of warnings) {
      expect(warning.message).toBe('Readiness check failed');
      const cause = String(warning.fields.cause);
      expect(cause).toContain('ENOTFOUND'); // useful to the operator
      expect(cause).toContain('[redacted-url]');
      expect(cause).not.toContain('postgresql://');
      expect(cause).not.toContain('leak-password');
    }
  });
});
