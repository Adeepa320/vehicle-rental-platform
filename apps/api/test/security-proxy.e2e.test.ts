import type { NestExpressApplication } from '@nestjs/platform-express';
import { refreshTokens, runMigrations, type DatabaseHandle } from '@vrp/database';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { TEST_PASSWORD, cleanupUsers, emailFactory, registerAndVerify } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping trusted-proxy e2e tests');

const SCOPE = 'prox';
const nextEmail = emailFactory(SCOPE);

/**
 * Behind one trusted proxy (`TRUST_PROXY_HOPS=1`, e.g. Railway's edge) the
 * client address is the right-most forwarded hop; anything the client itself
 * prepends is ignored, and a proxy that only sets `X-Real-IP` is understood.
 */
describe.skipIf(!url)(
  'trusted proxy (Phase 10): forwarded headers honoured only up to the configured hops',
  () => {
    let app: NestExpressApplication;
    let handle: DatabaseHandle;

    beforeAll(async () => {
      await runMigrations(url as string);
      app = await createTestApp({ DATABASE_URL: url as string, TRUST_PROXY_HOPS: '1' });
      handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    });

    afterAll(async () => {
      await cleanupUsers(app, SCOPE);
      await app.close();
    });

    const loginWith = async (headers: Record<string, string>): Promise<string | null> => {
      const email = nextEmail();
      const { user } = await registerAndVerify(app, email);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set(headers)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const [session] = await handle.db
        .select({ ip: refreshTokens.ip })
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, user.id))
        .orderBy(desc(refreshTokens.createdAt))
        .limit(1);
      return session?.ip ?? null;
    };

    it('takes the client address from the single trusted hop', async () => {
      expect(await loginWith({ 'X-Forwarded-For': '203.0.113.9' })).toBe('203.0.113.9');
    });

    it('ignores addresses the client prepended beyond the trusted hop', async () => {
      expect(await loginWith({ 'X-Forwarded-For': '198.51.100.7, 203.0.113.9' })).toBe(
        '203.0.113.9',
      );
    });

    it('understands a proxy that only sets X-Real-IP', async () => {
      expect(await loginWith({ 'X-Real-IP': '203.0.113.77' })).toBe('203.0.113.77');
    });

    it('falls back to the socket address without forwarding headers', async () => {
      expect(await loginWith({})).toMatch(/127\.0\.0\.1|::1/);
    });
  },
);
