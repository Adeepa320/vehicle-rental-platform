import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthSessionResponseSchema, UserSchema } from '@vrp/contracts';
import { refreshTokens, runMigrations, users, type DatabaseHandle } from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import {
  REFRESH_COOKIE_NAME,
  TEST_PASSWORD,
  cleanupUsers,
  emailFactory,
  login,
  nextSecond,
  refreshCookieFrom,
  registerAndVerify,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping session e2e tests');

const SCOPE = 'session';
const nextEmail = emailFactory(SCOPE);
const ORIGIN = 'http://localhost:3000';

describe.skipIf(!url)('login, access tokens, refresh rotation and logout', () => {
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

  it('logs in with correct credentials: bearer token in the body, refresh token only as an HttpOnly cookie', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const { body, cookie } = await login(app, email);

    expect(AuthSessionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken).toBeUndefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    // Only the hash is stored.
    const rawCookieValue = cookie.split(';')[0]?.split('=')[1] as string;
    const stored = await handle.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, body.user.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(rawCookieValue);
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the refresh token in the body for mobile clients', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, client: 'mobile' })
      .expect(200);
    expect(response.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers['set-cookie']).toBeUndefined();

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: response.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).toBeDefined();
    expect(refreshed.body.refreshToken).not.toBe(response.body.refreshToken);
  });

  it('rejects a wrong password and an unknown e-mail with the same generic 401', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'definitely-not-it-12345' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: nextEmail(), password: 'definitely-not-it-12345' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: wrong.body.error.message,
    });
  });

  it('serves and updates the profile for a valid access token', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const { body } = await login(app, email);

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(UserSchema.safeParse(me.body).success).toBe(true);
    expect(me.body.email).toBe(email);

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({
        fullName: 'Nimal P.',
        phone: '+94771234567',
        preferredCurrency: 'USD',
        countryCode: 'GB',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      fullName: 'Nimal P.',
      phone: '+94771234567',
      preferredCurrency: 'USD',
      countryCode: 'GB',
    });
  });

  it('rotates the refresh token and detects reuse by revoking the whole family', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const first = await login(app, email);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', first.cookieHeader)
      .expect(200);
    expect(AuthSessionResponseSchema.safeParse(rotated.body).success).toBe(true);
    const second = refreshCookieFrom(rotated);
    expect(second.cookieHeader).not.toBe(first.cookieHeader);

    // Replaying the rotated token is reuse: 401, cookie cleared, family revoked.
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', first.cookieHeader)
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_INVALID');
    expect(String(replay.headers['set-cookie'])).toMatch(new RegExp(`${REFRESH_COOKIE_NAME}=;`));

    const afterReuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', second.cookieHeader)
      .expect(401);
    expect(afterReuse.body.error.code).toBe('REFRESH_INVALID');
  });

  it('refuses refresh without a token and from a foreign origin', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const session = await login(app, email);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .expect(401);
    const csrf = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', session.cookieHeader)
      .expect(403);
    expect(csrf.body.error.code).toBe('FORBIDDEN');
  });

  it('logout revokes the current refresh token and clears the cookie; the access token still expires naturally', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const session = await login(app, email);

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookieHeader)
      .expect(204);
    expect(String(logout.headers['set-cookie'])).toMatch(new RegExp(`${REFRESH_COOKIE_NAME}=;`));

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookieHeader)
      .expect(401);
  });

  it('logout-all revokes every session and invalidates existing access tokens immediately', async () => {
    const email = nextEmail();
    await registerAndVerify(app, email);
    const one = await login(app, email);
    const two = await login(app, email);
    await nextSecond();

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${one.body.accessToken}`)
      .expect(204);

    for (const session of [one, two]) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', session.cookieHeader)
        .expect(401);
      const me = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${session.body.accessToken}`)
        .expect(401);
      expect(me.body.error.message).toMatch(/revoked/i);
    }

    // A fresh login works again.
    await nextSecond();
    const again = await login(app, email);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${again.body.accessToken}`)
      .expect(200);
  });

  it('blocks suspended accounts at login, on refresh and on protected routes', async () => {
    const email = nextEmail();
    const { user } = await registerAndVerify(app, email);
    const session = await login(app, email);
    await handle.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(403);
    expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookieHeader)
      .expect(403);
    const loginAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(403);
    expect(loginAttempt.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});
