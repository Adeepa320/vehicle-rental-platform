import { describe, expect, it } from 'vitest';

import { ApiClientError, createApiClient } from '../api-client';

const BASE = 'http://api.test/api/v1';
const ID = '0192f0a0-0000-7000-8000-000000000123';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeApi(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

const callAt = (calls: Call[], index: number): Call => {
  const call = calls[index];
  if (!call) throw new Error(`expected a recorded call #${index}`);
  return call;
};
const bodyOf = (call: Call) => JSON.parse(String(call.init.body)) as unknown;

describe('api client (inventory & availability)', () => {
  it('sends availability blocks and strips nothing the contract needs', async () => {
    const { api, calls } = fakeApi(200, {});
    await expect(
      api.vehicles.createBlock('tok', ID, {
        startsAt: '2026-11-01T00:00:00+05:30',
        endsAt: '2026-11-03T00:00:00+05:30',
        reason: 'maintenance',
        note: null,
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(callAt(calls, 0).url).toBe(`${BASE}/providers/me/vehicles/${ID}/blocks`);
    expect(callAt(calls, 0).init.method).toBe('POST');
    expect(bodyOf(callAt(calls, 0))).toEqual({
      startsAt: '2026-11-01T00:00:00+05:30',
      endsAt: '2026-11-03T00:00:00+05:30',
      reason: 'maintenance',
      note: null,
    });
  });

  it('queries availability with both instants and resolves 204 deletes', async () => {
    const { api, calls } = fakeApi(200, { unexpected: true });
    await expect(
      api.vehicles.availability('tok', ID, '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(callAt(calls, 0).url).toBe(
      `${BASE}/providers/me/vehicles/${ID}/availability?from=2026-11-01T00%3A00%3A00Z&to=2026-11-02T00%3A00%3A00Z`,
    );
    const gone = fakeApi(204, undefined);
    await expect(gone.api.vehicles.deleteBlock('tok', ID, ID)).resolves.toBeUndefined();
    expect(callAt(gone.calls, 0).init.method).toBe('DELETE');
    await expect(gone.api.locations.deactivate('tok', ID)).resolves.toBeUndefined();
    expect(callAt(gone.calls, 1).url).toBe(`${BASE}/providers/me/locations/${ID}`);
  });

  it('posts admin vehicle decisions without empty optional fields', async () => {
    const { api, calls } = fakeApi(200, {});
    await expect(
      api.admin.vehicleAction('tok', ID, 'approve', { adminNotes: '' }),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      api.admin.vehicleAction('tok', ID, 'reject', { reason: 'Plate mismatch.' }),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      api.admin.listVehicles('tok', { status: 'submitted', providerId: undefined, limit: 20 }),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(callAt(calls, 0).url).toBe(`${BASE}/admin/vehicles/${ID}/approve`);
    expect(bodyOf(callAt(calls, 0))).toEqual({});
    expect(bodyOf(callAt(calls, 1))).toEqual({ reason: 'Plate mismatch.' });
    expect(callAt(calls, 2).url).toBe(`${BASE}/admin/vehicles?status=submitted&limit=20`);
  });
});
