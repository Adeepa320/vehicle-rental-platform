import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { refreshTokens, runMigrations, users, type DatabaseHandle } from '@vrp/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { totpCode, totpStep } from '../src/modules/auth/mfa/totp';
import { TokenService } from '../src/modules/auth/token.service';
import {
  TEST_PASSWORD,
  cleanupUsers,
  emailFactory,
  login,
  refreshCookieFrom,
  type LoginResult,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { newAdmin, newVerifiedUser } from './utils/provider-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping session-binding e2e tests');

const SCOPE = 'sid';
const nextEmail = emailFactory(SCOPE);
const ORIGIN = 'http://localhost:3000';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
vi.setConfig({ testTimeout: 120_000 });

/** The `sid` claim of an access token (payload only; the server verifies signatures). */
const sidOf = (token: string): string =>
  (
    JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')) as {
      sid: string;
    }
  ).sid;

/**
 * Access tokens are bound to their logical session (`sid` = refresh-token family): a single-session
 * logout kills that session's access tokens at once and leaves the others alone (ASVS V7.4.1).
 */
describe.skipIf(!url)('session-bound access tokens (Phase 10, ASVS V7.4.1)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  const api = () => request(app.getHttpServer());
  const me = (token: string) => api().get('/api/v1/users/me').set(auth(token));
  const refreshWeb = (cookieHeader: string) =>
    api().post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', cookieHeader);
  const logoutWeb = (cookieHeader: string) =>
    api().post('/api/v1/auth/logout').set('Origin', ORIGIN).set('Cookie', cookieHeader);
  const liveInFamily = async (familyId: string) =>
    (
      await handle.db
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    ).length;

  /** Holds the user-row lock rotation and revocation serialise on, until `release()`. */
  async function holdUserLock(userId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => (locked = resolve));
    const done = handle.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      locked();
      await gate;
    });
    await acquired;
    return { release, done };
  }
  /** Polls PostgreSQL until `n` backends wait on the user-row lock (no fixed sleeps). */
  async function waitForLockWaiters(n: number) {
    for (let i = 0; i < 400; i += 1) {
      const [row] = await handle.db.execute<{ waiting: number }>(sql`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query ilike '%for no key update%'`);
      if ((row?.waiting ?? 0) >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`expected ${n} backends waiting on the user lock`);
  }
  const started = (test: request.Test): Promise<Response> =>
    new Promise((resolve, reject) => test.then(resolve, reject));

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('binds the access token to the refresh family; rotation keeps the sid, a new login gets a new one', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const sid = sidOf(user.body.accessToken);
    const [row] = await handle.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.userId));
    expect(row?.familyId).toBe(sid);

    const rotated = await refreshWeb(user.cookieHeader).expect(200);
    expect(sidOf(rotated.body.accessToken)).toBe(sid);
    const again = await refreshWeb(refreshCookieFrom(rotated).cookieHeader).expect(200);
    expect(sidOf(again.body.accessToken)).toBe(sid);
    // Tokens of one session minted before a rotation stay valid while the session lives.
    await me(user.body.accessToken).expect(200);
    await me(again.body.accessToken).expect(200);

    const other = await login(app, user.email);
    expect(sidOf(other.body.accessToken)).not.toBe(sid);
    // The sid is internal: not part of any response body.
    expect(JSON.stringify(other.body.user)).not.toContain(sidOf(other.body.accessToken));
  });

  it('logout of session A kills A at once (access and refresh lineage) and leaves session B valid until logout-all', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const a: LoginResult = user;
    // A rotates once, so A has two live access tokens (A1, A2) in one lineage.
    const aRotated = await refreshWeb(a.cookieHeader).expect(200);
    const a2 = aRotated.body.accessToken as string;
    const aCookie = refreshCookieFrom(aRotated).cookieHeader;
    const b = await login(app, user.email);

    await me(a.body.accessToken).expect(200);
    await me(a2).expect(200);
    await me(b.body.accessToken).expect(200);

    await logoutWeb(aCookie).expect(204);

    for (const token of [a.body.accessToken, a2]) {
      const denied = await me(token).expect(401);
      expect(denied.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(denied.body.error.message).toMatch(/revoked/i);
    }
    await refreshWeb(aCookie).expect(401);
    await refreshWeb(a.cookieHeader).expect(401);
    expect(await liveInFamily(sidOf(a2))).toBe(0);

    await me(b.body.accessToken).expect(200);
    const bRotated = await refreshWeb(b.cookieHeader).expect(200);
    const b2 = bRotated.body.accessToken as string;
    const bCookie = refreshCookieFrom(bRotated).cookieHeader;
    await me(b2).expect(200);

    await api().post('/api/v1/auth/logout-all').set('Origin', ORIGIN).set(auth(b2)).expect(204);
    await me(b2).expect(401);
    await me(b.body.accessToken).expect(401);
    await refreshWeb(bCookie).expect(401);
  });

  it('a bearer token alone names its session on logout; the mobile flow keeps the same binding', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const web = await login(app, user.email);
    await api()
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set(auth(web.body.accessToken))
      .send({})
      .expect(204);
    await me(web.body.accessToken).expect(401);
    await me(user.body.accessToken).expect(200);

    const mobile = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD, client: 'mobile' })
      .expect(200);
    const rotated = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: mobile.body.refreshToken })
      .expect(200);
    expect(sidOf(rotated.body.accessToken)).toBe(sidOf(mobile.body.accessToken));
    await api()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(204);
    await me(mobile.body.accessToken).expect(401);
    await me(rotated.body.accessToken).expect(401);
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
    // The web session the user started first is still fine.
    await me(user.body.accessToken).expect(200);
  });

  it('rejects unknown, expired, reused and foreign sessions; suspension and anonymisation still win', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const tokens = app.get(TokenService);

    // A correctly signed token for a session that never existed.
    const unknown = await tokens.signAccessToken({
      id: user.userId,
      roles: ['customer'],
      sessionId: randomUUID(),
    });
    await me(unknown.token).expect(401);

    // Another user's live session id does not help either.
    const other = await newVerifiedUser(app, nextEmail());
    const foreign = await tokens.signAccessToken({
      id: user.userId,
      roles: ['customer'],
      sessionId: sidOf(other.body.accessToken),
    });
    await me(foreign.token).expect(401);
    await me(other.body.accessToken).expect(200);

    // Reuse detection revokes the family, and with it the session's access tokens.
    const victim = await login(app, user.email);
    const rotated = await refreshWeb(victim.cookieHeader).expect(200);
    await refreshWeb(victim.cookieHeader).expect(401);
    await me(rotated.body.accessToken).expect(401);

    // A session whose refresh token has expired is no longer active.
    const expiring = await login(app, user.email);
    await handle.db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.familyId, sidOf(expiring.body.accessToken)));
    await me(expiring.body.accessToken).expect(401);

    // Suspension keeps its specific answer; anonymised (deleted) accounts are unauthenticated.
    const live = await login(app, user.email);
    await handle.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.userId));
    const suspended = await me(live.body.accessToken).expect(403);
    expect(suspended.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await handle.db.update(users).set({ status: 'deleted' }).where(eq(users.id, user.userId));
    await me(live.body.accessToken).expect(401);
  });

  it('binds the MFA-upgraded access token to the session that enrolled; logging that session out kills it', async () => {
    const admin = await newAdmin(app, nextEmail());
    const start = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(admin.body.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(200);
    const confirm = await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(admin.body.accessToken))
      .send({ code: totpCode(start.body.secret as string, totpStep(Date.now())) })
      .expect(200);
    const upgraded = confirm.body.session.accessToken as string;
    expect(sidOf(upgraded)).toBe(sidOf(admin.body.accessToken));
    await api().get('/api/v1/admin/overview').set(auth(upgraded)).expect(200);

    await logoutWeb(admin.cookieHeader).expect(204);
    await api().get('/api/v1/admin/overview').set(auth(upgraded)).expect(401);
  });

  it('request after a committed logout fails (no window between commit and the next request)', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    await me(user.body.accessToken).expect(200);
    await logoutWeb(user.cookieHeader).expect(204);
    await me(user.body.accessToken).expect(401);
  });

  it('race, refresh first: a refresh that wins the lock is then revoked by the waiting logout — the new tokens are dead', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const lock = await holdUserLock(user.userId);
    const refreshing = started(refreshWeb(user.cookieHeader));
    await waitForLockWaiters(1);
    const loggingOut = started(logoutWeb(user.cookieHeader));
    await waitForLockWaiters(2);
    lock.release();
    await lock.done;

    const [refreshed, loggedOut] = await Promise.all([refreshing, loggingOut]);
    expect(refreshed.status).toBe(200);
    expect(loggedOut.status).toBe(204);
    // The logout's UPDATE started after the rotation committed, so it saw and revoked the new token.
    expect(await liveInFamily(sidOf(user.body.accessToken))).toBe(0);
    await me(refreshed.body.accessToken as string).expect(401);
    await refreshWeb(refreshCookieFrom(refreshed).cookieHeader).expect(401);
  });

  it('race, logout first: the waiting refresh finds its token revoked and cannot resurrect the session', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const lock = await holdUserLock(user.userId);
    const loggingOut = started(logoutWeb(user.cookieHeader));
    await waitForLockWaiters(1);
    const refreshing = started(refreshWeb(user.cookieHeader));
    await waitForLockWaiters(2);
    lock.release();
    await lock.done;

    const [loggedOut, refreshed] = await Promise.all([loggingOut, refreshing]);
    expect(loggedOut.status).toBe(204);
    expect(refreshed.status).toBe(401);
    expect(await liveInFamily(sidOf(user.body.accessToken))).toBe(0);
    await me(user.body.accessToken).expect(401);
  });

  it('race, refresh vs logout-all: the rotated token is revoked too', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const other = await login(app, user.email);
    const lock = await holdUserLock(user.userId);
    const refreshing = started(refreshWeb(user.cookieHeader));
    await waitForLockWaiters(1);
    const loggingOutAll = started(
      api().post('/api/v1/auth/logout-all').set('Origin', ORIGIN).set(auth(other.body.accessToken)),
    );
    // logout-all waits on the same row lock through its `UPDATE users`.
    for (let i = 0; i < 400; i += 1) {
      const [row] = await handle.db.execute<{ waiting: number }>(sql`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`);
      if ((row?.waiting ?? 0) >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    lock.release();
    await lock.done;

    const [refreshed, loggedOutAll] = await Promise.all([refreshing, loggingOutAll]);
    expect(loggedOutAll.status).toBe(204);
    const live = await handle.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.userId), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
    if (refreshed.status === 200) await me(refreshed.body.accessToken as string).expect(401);
  });

  it('concurrent refresh and logout never leave a live session behind (20 unsynchronised rounds)', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    for (let round = 0; round < 20; round += 1) {
      const session = await login(app, user.email);
      const [refreshed] = await Promise.all([
        started(refreshWeb(session.cookieHeader)),
        started(logoutWeb(session.cookieHeader)),
      ]);
      expect(await liveInFamily(sidOf(session.body.accessToken))).toBe(0);
      await me(session.body.accessToken).expect(401);
      if (refreshed.status === 200) await me(refreshed.body.accessToken as string).expect(401);
    }
  });
});
