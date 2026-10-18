import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AuthSessionResponseSchema,
  MfaEnrolConfirmResponseSchema,
  MfaRecoveryCodesSchema,
  MfaRequiredResponseSchema,
  MfaStatusSchema,
  type MfaEnrolConfirmResponse,
  type MfaRequiredResponse,
} from '@vrp/contracts';
import { auditEvents, runMigrations, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { totpCode, totpStep } from '../src/modules/auth/mfa/totp';
import {
  TEST_PASSWORD,
  cleanupUsers,
  emailFactory,
  findEmail,
  refreshCookieFrom,
  takeAllEmails,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { newAdmin, newVerifiedUser, type ApplicantSession } from './utils/provider-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin MFA e2e tests');

const SCOPE = 'mfa';
const nextEmail = emailFactory(SCOPE);
const ORIGIN = 'http://localhost:3000';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const currentCode = (secret: string) => totpCode(secret, totpStep(Date.now()));
/** A code for a step far outside the accepted window: always wrong, never a lucky collision. */
const staleCode = (secret: string) => totpCode(secret, totpStep(Date.now()) - 5);
/**
 * The replay guard accepts each 30-second step once, so every successful verification in this
 * file uses a step above the last one (one ahead is inside the window); otherwise wait for the
 * next boundary. Wrong codes use staleCode() and consume nothing.
 */
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
vi.setConfig({ testTimeout: 150_000 });
const cookieExpiry = (cookie: string): number =>
  Date.parse(/Expires=([^;]+)/.exec(cookie)?.[1] ?? '');

describe.skipIf(!url)('admin MFA (Phase 10): enrolment, challenge, recovery, policy guard', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let admin: ApplicantSession;
  let customer: ApplicantSession;
  let secret = '';
  let recoveryCodes: string[] = [];
  let verifiedToken = '';

  const api = () => request(app.getHttpServer());
  const audits = (userId: string, action: string) =>
    handle.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, userId), eq(auditEvents.action, action)));
  const loginForChallenge = async (email: string): Promise<MfaRequiredResponse> => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    expect(MfaRequiredResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    return res.body as MfaRequiredResponse;
  };
  const enrol = async (
    session: ApplicantSession,
  ): Promise<{ secret: string; codes: string[]; token: string }> => {
    const start = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(session.body.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(200);
    const confirm = await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(session.body.accessToken))
      .send({ code: await freshCode(start.body.secret) })
      .expect(200);
    const body = confirm.body as MfaEnrolConfirmResponse;
    return {
      secret: start.body.secret,
      codes: body.recoveryCodes,
      token: body.session.accessToken,
    };
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string, ADMIN_MFA_REQUIRED: 'true' });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    admin = await newAdmin(app, nextEmail());
    customer = await newVerifiedUser(app, nextEmail());
    await takeAllEmails(app);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('blocks privileged routes for an admin without a factor; auth, MFA and the own profile stay reachable', async () => {
    const blocked = await api()
      .get('/api/v1/admin/overview')
      .set(auth(admin.body.accessToken))
      .expect(403);
    expect(blocked.body.error).toMatchObject({
      code: 'MFA_REQUIRED',
      details: [{ field: 'mfa', issue: 'enrolment_required' }],
    });
    await api().get('/api/v1/users/me').set(auth(admin.body.accessToken)).expect(200);
    const status = await api()
      .get('/api/v1/auth/mfa')
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(MfaStatusSchema.safeParse(status.body).success).toBe(true);
    expect(status.body).toMatchObject({
      enrolled: false,
      pendingEnrolment: false,
      required: true,
      sessionVerified: false,
      recoveryCodesRemaining: 0,
    });
    // Customers are refused by the role guard, not by the MFA guard, and cannot enrol.
    const forbidden = await api()
      .get('/api/v1/admin/overview')
      .set(auth(customer.body.accessToken))
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(customer.body.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(403);
    const customerStatus = await api()
      .get('/api/v1/auth/mfa')
      .set(auth(customer.body.accessToken))
      .expect(200);
    expect(customerStatus.body.required).toBe(false);
  });

  it('enrols an authenticator: password check, one-time secret, code confirmation, recovery codes, upgraded session', async () => {
    const wrongPassword = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(admin.body.accessToken))
      .send({ password: 'not-the-password' })
      .expect(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    const start = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(admin.body.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(200);
    secret = start.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(start.body.otpauthUri).toContain(`secret=${secret}`);
    expect(start.body.otpauthUri).toContain(encodeURIComponent(admin.email));
    expect(start.body).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
    const pending = await api()
      .get('/api/v1/auth/mfa')
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(pending.body).toMatchObject({ enrolled: false, pendingEnrolment: true });

    const wrongCode = await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(admin.body.accessToken))
      .send({ code: staleCode(secret) })
      .expect(401);
    expect(wrongCode.body.error.code).toBe('MFA_CODE_INVALID');
    await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(admin.body.accessToken))
      .send({ code: '12345' })
      .expect(400);

    const confirm = await api()
      .post('/api/v1/auth/mfa/enrol/confirm')
      .set(auth(admin.body.accessToken))
      .send({ code: await freshCode(secret) })
      .expect(200);
    expect(MfaEnrolConfirmResponseSchema.safeParse(confirm.body).success).toBe(true);
    const body = confirm.body as MfaEnrolConfirmResponse;
    recoveryCodes = body.recoveryCodes;
    expect(new Set(recoveryCodes).size).toBe(8);
    expect(recoveryCodes.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c))).toBe(true);
    expect(JSON.stringify(confirm.body)).not.toContain(secret);
    verifiedToken = body.session.accessToken;

    // The session that enrolled is upgraded; the pre-enrolment token stays blocked (its claim is false).
    await api().get('/api/v1/admin/overview').set(auth(verifiedToken)).expect(200);
    const stale = await api()
      .get('/api/v1/admin/overview')
      .set(auth(admin.body.accessToken))
      .expect(403);
    expect(stale.body.error.details[0].issue).toBe('challenge_required');

    const status = await api().get('/api/v1/auth/mfa').set(auth(verifiedToken)).expect(200);
    expect(status.body).toMatchObject({
      enrolled: true,
      pendingEnrolment: false,
      recoveryCodesRemaining: 8,
      required: true,
      sessionVerified: true,
    });
    expect(JSON.stringify(status.body)).not.toMatch(/secret|otpauth/);
    expect(await audits(admin.userId, 'mfa.enrolment_started')).toHaveLength(1);
    expect(await audits(admin.userId, 'mfa.enrolled')).toHaveLength(1);
    const mails = await takeAllEmails(app);
    expect(findEmail(mails, admin.email, 'Two-factor authentication was enabled')).toBeDefined();
    expect(JSON.stringify(mails)).not.toContain(secret);

    const again = await api()
      .post('/api/v1/auth/mfa/enrol/start')
      .set(auth(verifiedToken))
      .send({ password: TEST_PASSWORD })
      .expect(409);
    expect(again.body.error.code).toBe('MFA_ALREADY_ENROLLED');
  });

  it('turns a password login into a challenge; a valid code completes it, replays and bad tokens are refused, refresh keeps the factor', async () => {
    const challenge = await loginForChallenge(admin.email);
    expect(challenge.methods).toEqual(['totp', 'recovery_code']);
    expect(challenge.expiresIn).toBe(300);
    // The challenge token is not an access token.
    await api().get('/api/v1/users/me').set(auth(challenge.challengeToken)).expect(401);

    const bogus = await api()
      .post('/api/v1/auth/mfa/challenge')
      .set('Origin', ORIGIN)
      .send({ challengeToken: `${challenge.challengeToken}x`, code: currentCode(secret) })
      .expect(401);
    expect(bogus.body.error.code).toBe('MFA_CHALLENGE_INVALID');
    const wrong = await api()
      .post('/api/v1/auth/mfa/challenge')
      .set('Origin', ORIGIN)
      .send({ challengeToken: challenge.challengeToken, code: staleCode(secret) })
      .expect(401);
    expect(wrong.body.error.code).toBe('MFA_CODE_INVALID');

    const code = await freshCode(secret);
    const done = await api()
      .post('/api/v1/auth/mfa/challenge')
      .set('Origin', ORIGIN)
      .send({ challengeToken: challenge.challengeToken, code })
      .expect(200);
    expect(AuthSessionResponseSchema.safeParse(done.body).success).toBe(true);
    const { cookieHeader, cookie } = refreshCookieFrom(done);
    await api().get('/api/v1/admin/overview').set(auth(done.body.accessToken)).expect(200);
    // Admin sessions stay in the 8-hour class.
    expect(cookieExpiry(cookie) - Date.now()).toBeLessThanOrEqual(8 * 3_600_000 + 60_000);

    // The very same code cannot be accepted twice (replay), even through a fresh challenge.
    const second = await loginForChallenge(admin.email);
    const replay = await api()
      .post('/api/v1/auth/mfa/challenge')
      .set('Origin', ORIGIN)
      .send({ challengeToken: second.challengeToken, code })
      .expect(401);
    expect(replay.body.error.code).toBe('MFA_CODE_INVALID');

    // Rotation carries the verified factor and the short lifetime.
    const refreshed = await api()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieHeader)
      .send({})
      .expect(200);
    await api().get('/api/v1/admin/overview').set(auth(refreshed.body.accessToken)).expect(200);
    expect(cookieExpiry(refreshCookieFrom(refreshed).cookie) - Date.now()).toBeLessThanOrEqual(
      8 * 3_600_000 + 60_000,
    );
  });

  it('accepts each recovery code once, audits and e-mails its use, and regeneration invalidates the old set', async () => {
    const [first, second] = recoveryCodes as [string, string];
    const challenge = await loginForChallenge(admin.email);
    const done = await api()
      .post('/api/v1/auth/mfa/recovery')
      .set('Origin', ORIGIN)
      .send({ challengeToken: challenge.challengeToken, recoveryCode: first.toLowerCase() })
      .expect(200);
    await api().get('/api/v1/admin/overview').set(auth(done.body.accessToken)).expect(200);

    const reuse = await loginForChallenge(admin.email);
    const refused = await api()
      .post('/api/v1/auth/mfa/recovery')
      .set('Origin', ORIGIN)
      .send({ challengeToken: reuse.challengeToken, recoveryCode: first })
      .expect(401);
    expect(refused.body.error.code).toBe('MFA_CODE_INVALID');
    expect(await audits(admin.userId, 'mfa.recovery_code_used')).toHaveLength(1);
    const mails = await takeAllEmails(app);
    const notice = findEmail(mails, admin.email, 'recovery code was used');
    expect(notice?.text).toContain('7 recovery codes remain');
    expect(JSON.stringify(mails)).not.toContain(first);
    const status = await api().get('/api/v1/auth/mfa').set(auth(done.body.accessToken)).expect(200);
    expect(status.body.recoveryCodesRemaining).toBe(7);

    const regenerated = await api()
      .post('/api/v1/auth/mfa/recovery-codes')
      .set(auth(done.body.accessToken))
      .send({ password: TEST_PASSWORD, code: await freshCode(secret) })
      .expect(200);
    expect(MfaRecoveryCodesSchema.safeParse(regenerated.body).success).toBe(true);
    const fresh = regenerated.body.recoveryCodes as string[];
    expect(fresh).toHaveLength(8);
    expect(fresh).not.toContain(second);
    const oldCode = await loginForChallenge(admin.email);
    await api()
      .post('/api/v1/auth/mfa/recovery')
      .set('Origin', ORIGIN)
      .send({ challengeToken: oldCode.challengeToken, recoveryCode: second })
      .expect(401);
    const newCode = await loginForChallenge(admin.email);
    await api()
      .post('/api/v1/auth/mfa/recovery')
      .set('Origin', ORIGIN)
      .send({ challengeToken: newCode.challengeToken, recoveryCode: fresh[0] })
      .expect(200);
    expect(await audits(admin.userId, 'mfa.recovery_codes_regenerated')).toHaveLength(1);
    recoveryCodes = fresh;
  });

  it('locks the factor after repeated wrong codes and audits the lock', async () => {
    const other = await newAdmin(app, nextEmail());
    const enrolled = await enrol(other);
    const challenge = await loginForChallenge(other.email);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await api()
        .post('/api/v1/auth/mfa/challenge')
        .set('Origin', ORIGIN)
        .send({ challengeToken: challenge.challengeToken, code: staleCode(enrolled.secret) })
        .expect(401);
      expect(res.body.error.code).toBe('MFA_CODE_INVALID');
    }
    const locked = await api()
      .post('/api/v1/auth/mfa/challenge')
      .set('Origin', ORIGIN)
      .send({ challengeToken: challenge.challengeToken, code: currentCode(enrolled.secret) })
      .expect(429);
    expect(locked.body.error.code).toBe('MFA_LOCKED');
    // Recovery codes are refused too while locked.
    await api()
      .post('/api/v1/auth/mfa/recovery')
      .set('Origin', ORIGIN)
      .send({ challengeToken: challenge.challengeToken, recoveryCode: enrolled.codes[0] })
      .expect(429);
    expect(await audits(other.userId, 'mfa.locked')).toHaveLength(1);
    await takeAllEmails(app);
  });

  it('disables the factor with password and a current code; privileged access then needs a new enrolment', async () => {
    const wrong = await api()
      .post('/api/v1/auth/mfa/disable')
      .set(auth(verifiedToken))
      .send({ password: TEST_PASSWORD, code: staleCode(secret) })
      .expect(401);
    expect(wrong.body.error.code).toBe('MFA_CODE_INVALID');
    await api()
      .post('/api/v1/auth/mfa/disable')
      .set(auth(verifiedToken))
      .send({ password: 'wrong-password', code: staleCode(secret) })
      .expect(401);
    await api()
      .post('/api/v1/auth/mfa/disable')
      .set(auth(verifiedToken))
      .send({ password: TEST_PASSWORD, code: await freshCode(secret) })
      .expect(204);
    const status = await api().get('/api/v1/auth/mfa').set(auth(verifiedToken)).expect(200);
    expect(status.body).toMatchObject({ enrolled: false, sessionVerified: false });
    const blocked = await api().get('/api/v1/admin/overview').set(auth(verifiedToken)).expect(403);
    expect(blocked.body.error.details[0].issue).toBe('enrolment_required');
    expect(await audits(admin.userId, 'mfa.disabled')).toHaveLength(1);
    expect(
      findEmail(await takeAllEmails(app), admin.email, 'Two-factor authentication was disabled'),
    ).toBeDefined();
    // A password login is a full login again.
    const plain = await api()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: admin.email, password: TEST_PASSWORD })
      .expect(200);
    expect(plain.body.mfaRequired).toBeUndefined();
    expect(plain.body.accessToken).toBeDefined();
  });

  it('documents the MFA routes in OpenAPI', async () => {
    const docs = await api().get('/api/docs-json').expect(200);
    expect(Object.keys(docs.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/mfa',
        '/api/v1/auth/mfa/enrol/start',
        '/api/v1/auth/mfa/enrol/confirm',
        '/api/v1/auth/mfa/challenge',
        '/api/v1/auth/mfa/recovery',
        '/api/v1/auth/mfa/disable',
        '/api/v1/auth/mfa/recovery-codes',
      ]),
    );
  });
});
