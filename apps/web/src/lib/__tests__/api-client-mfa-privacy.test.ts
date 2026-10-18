import type { AdminPrivacyRequest, MfaStatus, PrivacyRequest, User } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import { ApiClientError, createApiClient } from '../api-client';

const BASE = 'http://api.test/api/v1';
const ID = '0192f0a0-0000-7000-8000-000000000123';
const USER_ID = '0192f0a0-0000-7000-8000-000000000456';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeApi(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

function fakeBinaryApi(status: number, bytes: Uint8Array<ArrayBuffer>, contentType: string) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(bytes, { status, headers: { 'content-type': contentType } });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

const callAt = (calls: Call[], index: number): Call => {
  const call = calls[index];
  if (!call) throw new Error(`expected a recorded call #${index}`);
  return call;
};
const headersOf = (call: Call) => call.init.headers as Record<string, string>;
const bodyOf = (call: Call): unknown => JSON.parse(String(call.init.body));

const user: User = {
  id: USER_ID,
  email: 'admin@example.com',
  emailVerified: true,
  fullName: 'Admin Person',
  phone: null,
  roles: ['admin'],
  status: 'active',
  preferredLanguage: 'en',
  preferredCurrency: 'LKR',
  countryCode: 'LK',
  createdAt: '2026-10-01T04:30:00.000Z',
};

const session = { tokenType: 'Bearer', accessToken: 'access-1', expiresIn: 900, user };

const mfaStatus: MfaStatus = {
  enrolled: true,
  pendingEnrolment: false,
  confirmedAt: '2026-10-16T10:00:00.000Z',
  recoveryCodesRemaining: 7,
  required: true,
  sessionVerified: true,
};

const privacyRequest: PrivacyRequest = {
  id: ID,
  type: 'deletion',
  status: 'open',
  requestedAt: '2026-10-17T06:00:00.000Z',
  acknowledgedAt: null,
  completedAt: null,
  rejectedAt: null,
  publicNote: null,
  blockers: ['open_booking_as_customer'],
};

const adminPrivacyRequest: AdminPrivacyRequest = {
  ...privacyRequest,
  source: 'self',
  requesterNote: 'Please delete everything.',
  internalNote: null,
  user: {
    id: USER_ID,
    email: 'nimal@example.com',
    fullName: 'Nimal Perera',
    status: 'active',
    roles: ['customer'],
  },
  handledBy: null,
  updatedAt: '2026-10-17T06:00:00.000Z',
};

describe('api client (MFA)', () => {
  it('accepts an MFA challenge instead of a session from login and keeps credentials', async () => {
    const { api, calls } = fakeApi(200, {
      mfaRequired: true,
      challengeToken: 'challenge-token-with-enough-length',
      expiresIn: 300,
      methods: ['totp', 'recovery_code'],
    });
    const result = await api.auth.login({ email: 'a@b.lk', password: 'pw', client: 'web' });
    expect(result).toMatchObject({ mfaRequired: true, methods: ['totp', 'recovery_code'] });
    expect(callAt(calls, 0).init.credentials).toBe('include');
  });

  it('still accepts a plain session from login', async () => {
    const { api } = fakeApi(200, session);
    const result = await api.auth.login({ email: 'a@b.lk', password: 'pw', client: 'web' });
    expect(result).toMatchObject({ accessToken: 'access-1' });
  });

  it('completes the challenge and recovery steps with the cookie enabled', async () => {
    const { api, calls } = fakeApi(200, session);
    await api.auth.mfaChallenge({
      challengeToken: 'challenge-token-with-enough-length',
      code: '123456',
    });
    await api.auth.mfaRecovery({
      challengeToken: 'challenge-token-with-enough-length',
      recoveryCode: 'ABCDE-FGHIJ',
    });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/auth/mfa/challenge`,
      `${BASE}/auth/mfa/recovery`,
    ]);
    expect(calls.every((c) => c.init.method === 'POST' && c.init.credentials === 'include')).toBe(
      true,
    );
    expect(bodyOf(callAt(calls, 0))).toEqual({
      challengeToken: 'challenge-token-with-enough-length',
      code: '123456',
    });
  });

  it('reads the status and runs the enrolment steps with the bearer token', async () => {
    const status = fakeApi(200, mfaStatus);
    await expect(status.api.mfa.status('tok')).resolves.toEqual(mfaStatus);
    expect(callAt(status.calls, 0).url).toBe(`${BASE}/auth/mfa`);
    expect(headersOf(callAt(status.calls, 0)).authorization).toBe('Bearer tok');

    const start = fakeApi(200, {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/VRP:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=VRP',
      issuer: 'VRP',
      account: 'admin@example.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const started = await start.api.mfa.enrolStart('tok', { password: 'correct horse battery' });
    expect(started.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(bodyOf(callAt(start.calls, 0))).toEqual({ password: 'correct horse battery' });

    const confirm = fakeApi(200, {
      recoveryCodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      generatedAt: '2026-10-17T06:00:00.000Z',
      session: { tokenType: 'Bearer', accessToken: 'upgraded', expiresIn: 900 },
    });
    const confirmed = await confirm.api.mfa.enrolConfirm('tok', { code: '123456' });
    expect(confirmed.session.accessToken).toBe('upgraded');
    expect(confirmed.recoveryCodes).toHaveLength(8);
    expect(callAt(confirm.calls, 0).url).toBe(`${BASE}/auth/mfa/enrol/confirm`);
  });

  it('disables with password + code (204) and regenerates recovery codes', async () => {
    const disable = fakeApi(204, undefined);
    await expect(
      disable.api.mfa.disable('tok', { password: 'pw', code: '654321' }),
    ).resolves.toBeUndefined();
    expect(callAt(disable.calls, 0).url).toBe(`${BASE}/auth/mfa/disable`);
    expect(bodyOf(callAt(disable.calls, 0))).toEqual({ password: 'pw', code: '654321' });

    const regen = fakeApi(200, {
      recoveryCodes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      generatedAt: '2026-10-17T06:00:00.000Z',
    });
    const codes = await regen.api.mfa.regenerateRecoveryCodes('tok', { password: 'pw', code: '1' });
    expect(codes.recoveryCodes).toHaveLength(8);
    expect(callAt(regen.calls, 0).url).toBe(`${BASE}/auth/mfa/recovery-codes`);
  });

  it('surfaces MFA_REQUIRED details so the shell can route the admin', async () => {
    const { api } = fakeApi(403, {
      error: {
        code: 'MFA_REQUIRED',
        message: 'Two-step verification is required',
        details: [{ field: 'mfa', issue: 'enrolment_required' }],
      },
    });
    const error = await api.admin.overview('tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 403,
      code: 'MFA_REQUIRED',
      details: [{ field: 'mfa', issue: 'enrolment_required' }],
    });
  });
});

describe('api client (privacy)', () => {
  it('downloads the personal-data export as a blob with the bearer token', async () => {
    const bytes = new TextEncoder().encode('{"schemaVersion":"vrp-user-export/1"}');
    const { api, calls } = fakeBinaryApi(200, bytes, 'application/json');
    const blob = await api.users.exportData('tok');
    expect(blob.size).toBe(bytes.byteLength);
    expect(callAt(calls, 0).url).toBe(`${BASE}/users/me/export`);
    expect(headersOf(callAt(calls, 0)).authorization).toBe('Bearer tok');
  });

  it('opens a deletion request (202) and lists my requests', async () => {
    const create = fakeApi(202, privacyRequest);
    const created = await create.api.users.requestDeletion('tok', {
      confirmEmail: 'nimal@example.com',
      note: 'Leaving the country.',
    });
    expect(created).toEqual(privacyRequest);
    expect(callAt(create.calls, 0).url).toBe(`${BASE}/users/me/delete-request`);
    expect(bodyOf(callAt(create.calls, 0))).toEqual({
      confirmEmail: 'nimal@example.com',
      note: 'Leaving the country.',
    });

    const list = fakeApi(200, { data: [privacyRequest] });
    await expect(list.api.users.privacyRequests('tok')).resolves.toEqual({
      data: [privacyRequest],
    });
    expect(callAt(list.calls, 0).url).toBe(`${BASE}/users/me/privacy-requests`);
  });

  it('rethrows PRIVACY_REQUEST_ALREADY_OPEN with its code', async () => {
    const { api } = fakeApi(409, {
      error: { code: 'PRIVACY_REQUEST_ALREADY_OPEN', message: 'A request is already open' },
    });
    const error = await api.users
      .requestDeletion('tok', { confirmEmail: 'nimal@example.com' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'PRIVACY_REQUEST_ALREADY_OPEN' });
  });

  it('builds the admin list query and posts the decisions to the right routes', async () => {
    const list = fakeApi(200, { data: [adminPrivacyRequest], nextCursor: null });
    await list.api.admin.listPrivacyRequests('tok', {
      status: 'open',
      type: 'deletion',
      limit: 25,
    });
    expect(callAt(list.calls, 0).url).toBe(
      `${BASE}/admin/privacy-requests?status=open&type=deletion&limit=25`,
    );

    const { api, calls } = fakeApi(200, adminPrivacyRequest);
    await api.admin.getPrivacyRequest('tok', ID);
    await api.admin.startPrivacyRequestReview('tok', ID);
    await api.admin.setPrivacyRequestInternalNote('tok', ID, { note: 'Checked bookings.' });
    await api.admin.completePrivacyAccessRequest('tok', ID, {
      publicNote: 'Your export was sent to your e-mail address.',
    });
    await api.admin.completePrivacyDeletionRequest('tok', ID, {
      reason: 'Requested by the account holder.',
      confirmEmail: 'nimal@example.com',
    });
    await api.admin.rejectPrivacyRequest('tok', ID, {
      publicNote: 'We could not verify that you own this account.',
      internalNote: 'E-mail mismatch.',
    });
    await api.admin.createPrivacyRequest('tok', {
      userId: USER_ID,
      type: 'access',
      requesterNote: 'Asked by phone.',
    });

    expect(calls.map((c) => [c.init.method ?? 'GET', c.url])).toEqual([
      ['GET', `${BASE}/admin/privacy-requests/${ID}`],
      ['POST', `${BASE}/admin/privacy-requests/${ID}/start-review`],
      ['PUT', `${BASE}/admin/privacy-requests/${ID}/internal-note`],
      ['POST', `${BASE}/admin/privacy-requests/${ID}/complete-access`],
      ['POST', `${BASE}/admin/privacy-requests/${ID}/complete-deletion`],
      ['POST', `${BASE}/admin/privacy-requests/${ID}/reject`],
      ['POST', `${BASE}/admin/privacy-requests`],
    ]);
    expect(bodyOf(callAt(calls, 1))).toEqual({});
    expect(bodyOf(callAt(calls, 4))).toEqual({
      reason: 'Requested by the account holder.',
      confirmEmail: 'nimal@example.com',
    });
    expect(bodyOf(callAt(calls, 6))).toEqual({
      userId: USER_ID,
      type: 'access',
      requesterNote: 'Asked by phone.',
    });
  });

  it('downloads the admin export as a blob and rejects a non-JSON error body', async () => {
    const bytes = new TextEncoder().encode('{}');
    const ok = fakeBinaryApi(200, bytes, 'application/json');
    await expect(ok.api.admin.privacyRequestExport('tok', ID)).resolves.toBeInstanceOf(Blob);
    expect(callAt(ok.calls, 0).url).toBe(`${BASE}/admin/privacy-requests/${ID}/export`);

    const denied = fakeBinaryApi(403, new TextEncoder().encode('nope'), 'text/plain');
    const error = await denied.api.admin.privacyRequestExport('tok', ID).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 403, code: 'INTERNAL' });
  });
});

describe('api client (system)', () => {
  it('reads the worker status and rejects an unexpected shape', async () => {
    const { api, calls } = fakeApi(200, {
      healthy: true,
      checkedAt: '2026-10-17T06:00:00.000Z',
      heartbeatQueue: 'reminders.sweep',
      staleAfterSeconds: 900,
      heartbeatLastCompletedAt: '2026-10-17T05:59:30.000Z',
      schedules: [
        { name: 'reminders.sweep', cron: '*/15 * * * *', updatedAt: '2026-10-17T05:45:00.000Z' },
      ],
      queues: [
        {
          name: 'email.send',
          lastCompletedAt: '2026-10-17T05:59:00.000Z',
          completedLast24h: 42,
          failedLast24h: 0,
          active: 0,
          queued: 1,
        },
      ],
    });
    const status = await api.admin.systemWorker('tok');
    expect(status.healthy).toBe(true);
    expect(status.queues[0]?.name).toBe('email.send');
    expect(callAt(calls, 0).url).toBe(`${BASE}/admin/system/worker`);

    const bad = fakeApi(200, { healthy: 'yes' });
    await expect(bad.api.admin.systemWorker('tok')).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe('api client (password change)', () => {
  it('posts the two passwords with the bearer token and the cookie, and accepts 204', async () => {
    const { api, calls } = fakeApi(204, undefined);
    const body = { currentPassword: 'old passphrase 2026', newPassword: 'new passphrase 2026' };
    await expect(api.users.changePassword('access-token', body)).resolves.toBeUndefined();
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/users/me/password`);
    expect(call.init.method).toBe('POST');
    expect(call.init.credentials).toBe('include');
    expect(headersOf(call).authorization).toBe('Bearer access-token');
    expect(bodyOf(call)).toEqual(body);
    // Nothing secret travels in the URL.
    expect(call.url).not.toContain('passphrase');
  });

  it('surfaces CURRENT_PASSWORD_INVALID with its field detail', async () => {
    const { api } = fakeApi(400, {
      error: {
        code: 'CURRENT_PASSWORD_INVALID',
        message: 'The current password is incorrect',
        details: [{ field: 'currentPassword', issue: 'is incorrect' }],
      },
    });
    const error = await api.users
      .changePassword('t', { currentPassword: 'x', newPassword: 'new passphrase 2026' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 400, code: 'CURRENT_PASSWORD_INVALID' });
  });
});
