import type { NestExpressApplication } from '@nestjs/platform-express';
import { ReadyResponseSchema } from '@vrp/contracts';
import { runMigrations } from '@vrp/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) {
  console.warn('DATABASE_URL_TEST is not set: skipping readiness tests that need PostgreSQL');
}

describe.skipIf(!url)('GET /api/v1/ready (database available)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ready with every check up once migrations are applied', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/ready').expect(200);
    const parsed = ReadyResponseSchema.safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.database.status).toBe('up');
    expect(response.body.checks.postgis.status).toBe('up');
    expect(response.body.checks.migrations.status).toBe('up');
    expect(response.body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
