import type { NestExpressApplication } from '@nestjs/platform-express';
import { runMigrations } from '@vrp/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping auth rate-limit e2e tests');

describe.skipIf(!url)('authentication rate limits', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({
      DATABASE_URL: url as string,
      AUTH_LOGIN_LIMIT_PER_MINUTE: '3',
      AUTH_SENSITIVE_LIMIT_PER_15MIN: '2',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('limits password attempts per IP', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `nobody-${i}@example.com`, password: 'wrong password 123' })
        .expect(401);
    }
    const limited = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong password 123' })
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits forgot-password requests per IP', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'a@example.com' })
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'b@example.com' })
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'c@example.com' })
      .expect(429);
  });
});
