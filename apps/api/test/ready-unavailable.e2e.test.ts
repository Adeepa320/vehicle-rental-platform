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
    expect(response.body.checks.database.message).toBe('database unavailable');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('secret');
    expect(body).not.toContain('postgresql://');
    // The driver error ("connect ECONNREFUSED 127.0.0.1:1") must not reach the public body.
    expect(body).not.toContain('127.0.0.1');
    expect(body).not.toContain('ECONNREFUSED');
  });
});

describe('GET /api/v1/ready (database host unresolvable)', () => {
  const HOST = 'vrp-ready-leak-canary.invalid';
  let app: NestExpressApplication;

  beforeAll(async () => {
    // `.invalid` never resolves (RFC 2606): the driver error names the host.
    app = await createTestApp({
      DATABASE_URL: `postgresql://leak_user:leak_password@${HOST}:6543/leak_db`,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 503 with generic per-check messages and no hostname, port or credentials', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    const response = await request(app.getHttpServer()).get('/api/v1/ready').expect(503);
    expect(ReadyResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks).toMatchObject({
      database: { status: 'down', message: 'database unavailable' },
      postgis: { status: 'down', message: 'PostGIS unavailable' },
      migrations: { status: 'down', message: 'migration check unavailable' },
    });
    const body = JSON.stringify(response.body);
    for (const fragment of [
      HOST,
      'leak-canary',
      '6543',
      'leak_user',
      'leak_password',
      'leak_db',
      'ENOTFOUND',
      'getaddrinfo',
      'postgresql://',
    ]) {
      expect(body).not.toContain(fragment);
    }
  });
});
