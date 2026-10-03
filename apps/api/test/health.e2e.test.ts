import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiErrorSchema, HealthResponseSchema } from '@vrp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './utils/create-app';

describe('GET /api/v1/health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a valid liveness payload and generates a request id', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const parsed = HealthResponseSchema.safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.environment).toBe('test');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed client-supplied request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'web-abc.123')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('web-abc.123');
  });

  it('replaces a malformed client-supplied request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'not valid: has spaces')
      .expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the uniform error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(ApiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('serves nothing outside the versioned prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('applies the security and CORS baseline', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-expose-headers']).toContain('x-request-id');

    const blocked = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
