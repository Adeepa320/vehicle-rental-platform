import type { NestExpressApplication } from '@nestjs/platform-express';
import { ReadyResponseSchema } from '@vrp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './utils/create-app';

describe('GET /api/v1/ready (database unreachable)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Port 1 is never a PostgreSQL server: the connection is refused immediately.
    app = await createTestApp({
      DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:1/unreachable',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('still boots, then reports 503 not_ready without leaking the connection string', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    const response = await request(app.getHttpServer()).get('/api/v1/ready').expect(503);
    expect(ReadyResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.database.status).toBe('down');
    expect(response.body.checks.database.message).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });
});
