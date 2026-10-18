import type { NestExpressApplication } from '@nestjs/platform-express';
import { refreshTokens, runMigrations, type DatabaseHandle } from '@vrp/database';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { TEST_PASSWORD, cleanupUsers, emailFactory, registerAndVerify } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping security header e2e tests');

const SCOPE = 'sech';
const nextEmail = emailFactory(SCOPE);
const WEB = 'http://localhost:3000';
const OTHER = 'https://app.example.lk';

/**
 * Production-like HTTP posture (Phase 10, SECURITY_AND_PRIVACY §4): Swagger
 * and the fake gateway off, HSTS on, Secure cookie, two allowed origins.
 */
describe.skipIf(!url)(
  'security headers, CORS, body limits and the Secure cookie (Phase 10)',
  () => {
    let app: NestExpressApplication;
    let handle: DatabaseHandle;
    const api = () => request(app.getHttpServer());

    beforeAll(async () => {
      await runMigrations(url as string);
      app = await createTestApp({
        DATABASE_URL: url as string,
        OPENAPI_ENABLED: 'false',
        PAYMENT_GATEWAY: 'payhere',
        PAYHERE_MERCHANT_ID: '1211149',
        PAYHERE_MERCHANT_SECRET: 'e2e-fake-merchant-secret-32-characters!',
        HSTS_ENABLED: 'true',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: `${WEB},${OTHER}`,
      });
      handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    });

    afterAll(async () => {
      await cleanupUsers(app, SCOPE);
      await app.close();
    });

    it('sends a locked-down header set on every JSON response', async () => {
      const res = await api().get('/api/v1/health').expect(200);
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['x-powered-by']).toBeUndefined();
      // Developer-only surfaces are gone.
      await api().get('/api/docs-json').expect(404);
      await api().post('/api/v1/payments/fake/checkout').send({}).expect(404);
    });

    it('answers CORS only for the configured origins, with credentials', async () => {
      const allowed = await api().get('/api/v1/health').set('Origin', OTHER).expect(200);
      expect(allowed.headers['access-control-allow-origin']).toBe(OTHER);
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(allowed.headers['vary']).toContain('Origin');
      const denied = await api()
        .get('/api/v1/health')
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await api()
        .options('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      const nullOrigin = await api().get('/api/v1/health').set('Origin', 'null').expect(200);
      expect(nullOrigin.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses oversized JSON and form bodies with 413', async () => {
      const big = await api()
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'x@example.com', password: 'p'.repeat(300 * 1024) }))
        .expect(413);
      expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      await api()
        .post('/api/v1/payments/payhere/notify')
        .type('form')
        .send(`merchant_id=1&order_id=${'x'.repeat(70 * 1024)}`)
        .expect(413);
    });

    it('issues the refresh cookie with the __Secure- prefix, reads it back and clears it on logout', async () => {
      const email = nextEmail();
      const { user } = await registerAndVerify(app, email);
      const login = await api()
        .post('/api/v1/auth/login')
        .set('Origin', WEB)
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const cookies = login.headers['set-cookie'] as unknown as string[];
      const cookie = cookies.find((c) => c.startsWith('__Secure-vrp_refresh=')) as string;
      expect(cookie).toBeDefined();
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookies.some((c) => c.startsWith('vrp_refresh='))).toBe(false);

      const refreshed = await api()
        .post('/api/v1/auth/refresh')
        .set('Origin', WEB)
        .set('Cookie', cookie.split(';')[0] as string)
        .send({})
        .expect(200);
      expect(refreshed.body.accessToken).toBeDefined();
      const rotated = (refreshed.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('__Secure-vrp_refresh='),
      ) as string;
      const logout = await api()
        .post('/api/v1/auth/logout')
        .set('Origin', WEB)
        .set('Cookie', rotated.split(';')[0] as string)
        .send({})
        .expect(204);
      const cleared = (logout.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('__Secure-vrp_refresh='),
      ) as string;
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

      // With TRUST_PROXY_HOPS=0 a client-supplied X-Forwarded-For is ignored.
      const [session] = await handle.db
        .select({ ip: refreshTokens.ip })
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, user.id))
        .orderBy(desc(refreshTokens.createdAt))
        .limit(1);
      expect(session?.ip).not.toBe('203.0.113.9');
      expect(session?.ip ?? '').toMatch(/127\.0\.0\.1|::1/);
    });
  },
);
