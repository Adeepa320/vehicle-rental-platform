import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './utils/create-app';

describe('OpenAPI document', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes the auth and user routes from the Zod contracts', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const document = response.body as {
      openapi: string;
      paths: Record<
        string,
        Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>
      >;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
    };
    expect(document.openapi).toMatch(/^3\.0/);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/health',
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/users/me',
      ]),
    );
    const login = document.paths['/api/v1/auth/login']?.post;
    expect(login?.requestBody).toBeDefined();
    expect(JSON.stringify(login?.requestBody)).toContain('"email"');
    expect(login?.responses['200']).toBeDefined();
    expect(document.components.schemas.ApiError).toBeDefined();
    expect(document.components.securitySchemes.bearer).toBeDefined();
  });
});
