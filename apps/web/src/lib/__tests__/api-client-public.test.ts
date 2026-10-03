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
    return new Response(JSON.stringify(body), {
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
const headersOf = (call: Call) => call.init.headers as Record<string, string>;

describe('api client (public discovery & photos)', () => {
  it('searches without credentials and drops empty parameters', async () => {
    const { api, calls } = fakeApi(200, {
      data: [],
      nextCursor: null,
      criteria: {
        place: null,
        districtId: null,
        radiusKm: null,
        startsAt: null,
        endsAt: null,
        days: null,
        sort: 'relevance',
      },
    });
    const result = await api.public.search({
      placeId: ID,
      startsAt: undefined,
      categoryId: '',
      sort: 'relevance',
      limit: 20,
    });
    expect(result.data).toEqual([]);
    expect(callAt(calls, 0).url).toBe(
      `${BASE}/vehicles/search?placeId=${ID}&sort=relevance&limit=20`,
    );
    expect(headersOf(callAt(calls, 0)).authorization).toBeUndefined();
  });

  it('encodes the vehicle slug and passes the availability window', async () => {
    const { api, calls } = fakeApi(200, {});
    await expect(
      api.public.vehicle('toyota aqua', {
        startsAt: '2026-11-10T00:00:00+05:30',
        endsAt: '2026-11-13T00:00:00+05:30',
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(callAt(calls, 0).url).toBe(
      `${BASE}/vehicles/toyota%20aqua?startsAt=2026-11-10T00%3A00%3A00%2B05%3A30&endsAt=2026-11-13T00%3A00%3A00%2B05%3A30`,
    );
    await expect(api.public.suggestPlaces('mir')).rejects.toBeInstanceOf(ApiClientError);
    expect(callAt(calls, 1).url).toBe(`${BASE}/places/suggest?q=mir&limit=8`);
  });

  it('uploads photos as multipart without a JSON content type', async () => {
    const { api, calls } = fakeApi(200, {});
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await expect(api.vehicles.uploadPhoto('tok', ID, file)).rejects.toBeInstanceOf(ApiClientError);
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/providers/me/vehicles/${ID}/photos`);
    expect(call.init.method).toBe('POST');
    expect(headersOf(call)['content-type']).toBeUndefined();
    expect(headersOf(call).authorization).toBe('Bearer tok');
    expect(call.init.body).toBeInstanceOf(FormData);
    expect((call.init.body as FormData).get('file')).toBeInstanceOf(Blob);

    await expect(api.vehicles.reorderPhotos('tok', ID, [ID])).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(callAt(calls, 1).url).toBe(`${BASE}/providers/me/vehicles/${ID}/photos/order`);
    expect(JSON.parse(String(callAt(calls, 1).init.body))).toEqual({ photoIds: [ID] });
  });
});
