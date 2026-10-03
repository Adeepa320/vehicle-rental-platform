import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './utils/create-app';

describe('global rate limit', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ RATE_LIMIT_MAX: '3', RATE_LIMIT_TTL_SECONDS: '60' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows RATE_LIMIT_MAX requests then answers 429 with the error envelope', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    }
    const limited = await request(app.getHttpServer()).get('/api/v1/health').expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.message).toMatch(/too many requests/i);
    expect(limited.body.error.requestId).toBe(limited.headers['x-request-id']);
  });
});
