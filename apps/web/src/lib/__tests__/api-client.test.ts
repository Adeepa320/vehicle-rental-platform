import { describe, expect, it } from 'vitest';

import { ApiClientError, createApiClient } from '../api-client';

const BASE = 'http://api.test/api/v1';
const APP_ID = '0192f0a0-0000-7000-8000-000000000123';

interface Call {
  url: string;
  init: RequestInit;
}

/** Fake fetch that records every call and answers with one fixed JSON body. */
function fakeApi(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

const headerOf = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];
const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as unknown;
const callAt = (calls: Call[], index: number): Call => {
  const call = calls[index];
  if (!call) throw new Error(`expected a recorded call #`);
  return call;
};

describe('api client (providers & admin)', () => {
  it('treats a missing application as null and sends the bearer token', async () => {
    const { api, calls } = fakeApi(404, {
      error: { code: 'NOT_FOUND', message: 'No application yet', requestId: 'req-1' },
    });
    await expect(api.providers.myApplication('tok')).resolves.toBeNull();
    expect(callAt(calls, 0).url).toBe(`${BASE}/providers/me/application`);
    expect(headerOf(callAt(calls, 0), 'authorization')).toBe('Bearer tok');
    expect(callAt(calls, 0).init.credentials).toBe('same-origin');
  });

  it('rethrows other API errors with their code and request id', async () => {
    const { api } = fakeApi(500, {
      error: { code: 'INTERNAL', message: 'Something broke', requestId: 'req-2' },
    });
    const error = await api.providers.myProfile('tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL', requestId: 'req-2' });
  });

  it('builds reference and admin list queries without empty parameters', async () => {
    const { api, calls } = fakeApi(200, []);
    await api.reference.places('matara');
    await api.reference.places();
    expect(callAt(calls, 0).url).toBe(`${BASE}/reference/places?districtId=matara`);
    expect(callAt(calls, 1).url).toBe(`${BASE}/reference/places`);

    const admin = fakeApi(200, { data: [], nextCursor: null });
    await admin.api.admin.listApplications('tok', { status: 'submitted', limit: 20 });
    expect(callAt(admin.calls, 0).url).toBe(
      `${BASE}/admin/provider-applications?status=submitted&limit=20`,
    );
  });

  it('posts admin decisions to the right route with the reason body', async () => {
    const { api, calls } = fakeApi(200, {});
    // The fake returns an invalid admin view, so the call rejects after the request was made.
    await expect(
      api.admin.requestChanges('tok', APP_ID, 'Please add the address.'),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.admin.approve('tok', APP_ID)).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.admin.approve('tok', APP_ID, 'Called the owner.')).rejects.toBeInstanceOf(
      ApiClientError,
    );
    await expect(
      api.admin.suspendProvider('tok', APP_ID, 'Repeated no-shows.'),
    ).rejects.toBeInstanceOf(ApiClientError);

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/provider-applications/${APP_ID}/request-changes`,
      `${BASE}/admin/provider-applications/${APP_ID}/approve`,
      `${BASE}/admin/provider-applications/${APP_ID}/approve`,
      `${BASE}/admin/providers/${APP_ID}/suspend`,
    ]);
    expect(calls.every((c) => c.init.method === 'POST')).toBe(true);
    expect(bodyOf(callAt(calls, 0))).toEqual({ reason: 'Please add the address.' });
    expect(bodyOf(callAt(calls, 1))).toEqual({});
    expect(bodyOf(callAt(calls, 2))).toEqual({ adminNotes: 'Called the owner.' });
    expect(bodyOf(callAt(calls, 3))).toEqual({ reason: 'Repeated no-shows.' });
  });

  it('submits the application with the agreement flag only', async () => {
    const { api, calls } = fakeApi(200, {});
    await expect(api.providers.submitApplication('tok')).rejects.toBeInstanceOf(ApiClientError);
    expect(callAt(calls, 0).url).toBe(`${BASE}/providers/me/application/submit`);
    expect(bodyOf(callAt(calls, 0))).toEqual({ acceptProviderAgreement: true });
  });

  it('rejects unexpected response shapes instead of trusting them', async () => {
    const { api } = fakeApi(200, { unexpected: true });
    const error = await api.users.me('tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 200, code: 'INTERNAL' });
  });
});
