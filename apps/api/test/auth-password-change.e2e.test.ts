import type { NestExpressApplication } from '@nestjs/platform-express';
import { MfaRequiredResponseSchema, type MfaEnrolConfirmResponse } from '@vrp/contracts';
import {
  auditEvents,
  refreshTokens,
  runMigrations,
  users,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { totpCode, totpStep } from '../src/modules/auth/mfa/totp';
import {
  REFRESH_COOKIE_NAME,
  TEST_PASSWORD,
  cleanupUsers,
  emailFactory,
  findEmail,
  login,
  takeAllEmails,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  newAdmin,
  newVerifiedUser,
  seedReference,
  type ApplicantSession,
} from './utils/provider-helpers';
import { approvedProvider } from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping password-change e2e tests');

const SCOPE = 'pwchange';
const nextEmail = emailFactory(SCOPE);
const ORIGIN = 'http://localhost:3000';
const NEW_PASSWORD = 'a brand new passphrase 2026';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
vi.setConfig({ testTimeout: 120_000 });

/** One accepted TOTP step per call (the replay guard accepts each step once). */
const usedSteps = new Map<string, number>();
async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const now = totpStep(Date.now());
    const candidate = Math.max((usedSteps.get(secret) ?? -1) + 1, now - 1);
    if (candidate <= now + 1) {
      usedSteps.set(secret, candidate);
      return totpCode(secret, candidate);
    }
    await new Promise((resolve) => setTimeout(resolve, (now + 1) * 30_000 - Date.now() + 50));
  }
}

describe.skipIf(!url)('POST /users/me/password (Phase 10, ASVS V6.2.3)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  const api = () => request(app.getHttpServer());
  const change = (token: string, body: Record<string, unknown>) =>
    api().post('/api/v1/users/me/password').set(auth(token)).send(body);
  const liveSessions = async (userId: string) =>
    (
      await handle.db
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    ).length;
  const hashOf = async (userId: string) =>
    (
      await handle.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
    )[0]?.passwordHash;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string, ADMIN_MFA_REQUIRED: 'true' });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('requires authentication and a strict body', async () => {
    const anonymous = await api()
      .post('/api/v1/users/me/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const customer = await newVerifiedUser(app, nextEmail());
    for (const body of [
      {},
      { currentPassword: TEST_PASSWORD },
      { newPassword: NEW_PASSWORD },
      { currentPassword: '', newPassword: NEW_PASSWORD },
      // Identity, role and session fields are never accepted: the caller is the token's subject.
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, userId: customer.userId },
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, email: customer.email },
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, roles: ['admin'] },
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, sessionId: 'x' },
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false },
      { currentPassword: TEST_PASSWORD, passwordHash: '$argon2id$v=19$m=1,t=1,p=1$x$y' },
    ]) {
      const response = await change(customer.body.accessToken, body).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    // Nothing changed.
    await login(app, customer.email);
  });

  it('rejects a wrong current password, a weak or common new password and reuse — with the same policy as registration', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const before = await hashOf(customer.userId);

    const wrong = await change(customer.body.accessToken, {
      currentPassword: 'not the current password',
      newPassword: NEW_PASSWORD,
    }).expect(400);
    expect(wrong.body.error).toMatchObject({
      code: 'CURRENT_PASSWORD_INVALID',
      details: [{ field: 'currentPassword', issue: 'is incorrect' }],
    });
    expect(JSON.stringify(wrong.body)).not.toContain('not the current password');

    const tooShort = await change(customer.body.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'short',
    }).expect(400);
    expect(tooShort.body.error.details[0].field).toBe('newPassword');

    for (const [newPassword, issue] of [
      ['password123', /too common/],
      ['aaaaaaaaaaaa', /repeat a single character/],
      ['Nimal Perera 2026', /must not contain your name/],
    ] as const) {
      const weak = await change(customer.body.accessToken, {
        currentPassword: TEST_PASSWORD,
        newPassword,
      }).expect(400);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');
      expect(weak.body.error.details).toEqual([
        { field: 'newPassword', issue: expect.stringMatching(issue) },
      ]);
    }

    const reuse = await change(customer.body.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
    }).expect(400);
    expect(reuse.body.error.details).toEqual([
      { field: 'newPassword', issue: 'must be different from your current password' },
    ]);

    // Every refusal left the account and its session untouched.
    expect(await hashOf(customer.userId)).toBe(before);
    await api().get('/api/v1/users/me').set(auth(customer.body.accessToken)).expect(200);
  });

  it('changes a customer password: new Argon2id hash, every session and access token revoked, old password refused, new accepted, other users untouched', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const second = await login(app, customer.email);
    const mobile = await api()
      .post('/api/v1/auth/login')
      .send({ email: customer.email, password: TEST_PASSWORD, client: 'mobile' })
      .expect(200);
    const bystander = await newVerifiedUser(app, nextEmail());
    const before = await hashOf(customer.userId);
    expect(await liveSessions(customer.userId)).toBe(3);
    await takeAllEmails(app);

    const response = await change(customer.body.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(204);
    expect(response.text).toBe('');
    // The (now revoked) refresh cookie is cleared for the browser.
    expect(String(response.headers['set-cookie'])).toMatch(new RegExp(`${REFRESH_COOKIE_NAME}=;`));

    const after = await hashOf(customer.userId);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$argon2id\$/);
    expect(after).not.toContain(NEW_PASSWORD);

    // Every refresh session is gone and every old access token fails at once.
    expect(await liveSessions(customer.userId)).toBe(0);
    for (const token of [
      customer.body.accessToken,
      second.body.accessToken,
      mobile.body.accessToken as string,
    ]) {
      const me = await api().get('/api/v1/users/me').set(auth(token)).expect(401);
      expect(me.body.error.message).toMatch(/revoked/i);
    }
    for (const cookie of [customer.cookieHeader, second.cookieHeader]) {
      await api()
        .post('/api/v1/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .expect(401);
    }
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: mobile.body.refreshToken })
      .expect(401);

    // Old password refused, new one accepted.
    const old = await api()
      .post('/api/v1/auth/login')
      .send({ email: customer.email, password: TEST_PASSWORD })
      .expect(401);
    expect(old.body.error.code).toBe('INVALID_CREDENTIALS');
    const fresh = await login(app, customer.email, NEW_PASSWORD);
    const me = await api().get('/api/v1/users/me').set(auth(fresh.body.accessToken)).expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(/argon2|passwordHash|password_hash/i);

    // An unrelated user's session is unchanged.
    await api().get('/api/v1/users/me').set(auth(bystander.body.accessToken)).expect(200);
    expect(await liveSessions(bystander.userId)).toBe(1);

    // Audited without any password material; the owner is notified.
    const audits = await handle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, customer.userId),
          eq(auditEvents.action, 'user.password_changed'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: customer.userId, actorType: 'customer' });
    const serialised = JSON.stringify(audits[0]);
    for (const secret of [TEST_PASSWORD, NEW_PASSWORD, before ?? '-', after ?? '-']) {
      expect(serialised).not.toContain(secret);
    }
    const mail = findEmail(await takeAllEmails(app), customer.email);
    expect(mail?.subject).toMatch(/password/i);
    expect(mail?.text).not.toContain(NEW_PASSWORD);
  });

  it('works for a provider (no MFA required) and records a provider actor', async () => {
    // Approving the application needs an MFA-verified admin under this suite's policy.
    const admin = await newAdmin(app, nextEmail());
    const start = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(admin.body.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(200);
    const confirm = await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(admin.body.accessToken))
      .send({ code: await freshCode(start.body.secret as string) })
      .expect(200);
    const verifiedAdmin: ApplicantSession = {
      ...admin,
      body: {
        ...admin.body,
        accessToken: (confirm.body as MfaEnrolConfirmResponse).session.accessToken,
      },
    };
    const refs = await seedReference(app);
    const provider = await approvedProvider(app, nextEmail(), refs, verifiedAdmin);

    await change(provider.body.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(204);
    await api().get('/api/v1/providers/me').set(auth(provider.body.accessToken)).expect(401);
    const fresh = await login(app, provider.email, NEW_PASSWORD);
    await api().get('/api/v1/providers/me').set(auth(fresh.body.accessToken)).expect(200);
    const [audit] = await handle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, provider.userId),
          eq(auditEvents.action, 'user.password_changed'),
        ),
      );
    expect(audit?.actorType).toBe('provider');
  });

  it('keeps admin MFA intact: an unverified admin session is refused; a verified one changes the password and the next login still needs the second factor', async () => {
    const admin = await newAdmin(app, nextEmail());
    const blocked = await change(admin.body.accessToken, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(403);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');

    const start = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(admin.body.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(200);
    const secret = start.body.secret as string;
    const confirm = await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(admin.body.accessToken))
      .send({ code: await freshCode(secret) })
      .expect(200);
    const verified = (confirm.body as MfaEnrolConfirmResponse).session.accessToken;

    // A challenge minted before the change must not open a session afterwards.
    const pending = await api()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD })
      .expect(200);
    expect(MfaRequiredResponseSchema.safeParse(pending.body).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 50));

    await change(verified, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }).expect(
      204,
    );
    await api().get('/api/v1/admin/overview').set(auth(verified)).expect(401);
    const stale = await api()
      .post('/api/v1/auth/mfa/challenge')
      .send({ challengeToken: pending.body.challengeToken, code: await freshCode(secret) })
      .expect(401);
    expect(stale.body.error.code).toBe('MFA_CHALLENGE_INVALID');

    await new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + 50));
    const next = await api()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: NEW_PASSWORD })
      .expect(200);
    expect(MfaRequiredResponseSchema.safeParse(next.body).success).toBe(true);
    const session = await api()
      .post('/api/v1/auth/mfa/challenge')
      .set('Origin', ORIGIN)
      .send({ challengeToken: next.body.challengeToken, code: await freshCode(secret) })
      .expect(200);
    await api().get('/api/v1/admin/overview').set(auth(session.body.accessToken)).expect(200);
    const [audit] = await handle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, admin.userId),
          eq(auditEvents.action, 'user.password_changed'),
        ),
      );
    expect(audit?.actorType).toBe('admin');
  });

  it('is documented in the OpenAPI contract', async () => {
    const spec = await api().get('/api/docs-json').expect(200);
    const operation = spec.body.paths['/api/v1/users/me/password']?.post;
    expect(operation?.responses['204']).toBeDefined();
    expect(JSON.stringify(operation?.requestBody)).toContain('"currentPassword"');
  });
});
