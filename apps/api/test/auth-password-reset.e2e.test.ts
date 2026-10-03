import type { NestExpressApplication } from '@nestjs/platform-express';
import { oneTimeTokens, runMigrations, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import {
  TEST_PASSWORD,
  cleanupUsers,
  emailFactory,
  extractToken,
  login,
  nextSecond,
  registerAndVerify,
  takeEmailFor,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping password reset e2e tests');

const SCOPE = 'reset';
const nextEmail = emailFactory(SCOPE);
const ORIGIN = 'http://localhost:3000';
const NEW_PASSWORD = 'brand new passphrase 2026';

describe.skipIf(!url)('password reset', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('answers forgot-password identically for known and unknown e-mails', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);

    const known = await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email })
      .expect(202);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: nextEmail() })
      .expect(202);
    expect(unknown.body).toEqual(known.body);

    expect(await takeEmailFor(app, email, 'Reset')).toBeDefined();
  });

  it('resets the password with a single-use token and signs out every existing session', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const before = await login(app, email);
    await nextSecond();

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email })
      .expect(202);
    const token = extractToken(await takeEmailFor(app, email, 'Reset'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(200);
    expect(await takeEmailFor(app, email, 'changed')).toBeDefined();

    // Old sessions are dead: refresh token revoked and access token rejected.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', before.cookieHeader)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${before.body.accessToken}`)
      .expect(401);

    // Old password no longer works; new one does.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(401);
    await login(app, email, NEW_PASSWORD);

    // The token cannot be used twice.
    const reused = await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: 'another strong passphrase' })
      .expect(400);
    expect(reused.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects expired reset tokens and weak replacement passwords', async () => {
    const email = nextEmail();
    const { user } = await registerAndVerify(app, email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email })
      .expect(202);
    const token = extractToken(await takeEmailFor(app, email, 'Reset'));

    const weak = await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: 'short' })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    await handle.db
      .update(oneTimeTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.purpose, 'password_reset')));
    const expired = await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(400);
    expect(expired.body.error.code).toBe('TOKEN_EXPIRED');

    // Still able to log in with the original password.
    await login(app, email);
  });
});
