import type { Booking } from '@vrp/contracts';
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

/** A complete customer view that satisfies `BookingSchema`. */
export function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: ID,
    reference: 'SLR-7F3K2Q',
    status: 'requested',
    version: 1,
    viewer: 'customer',
    vehicle: {
      id: ID,
      slug: 'toyota-aqua-2018-mirissa-ab12',
      title: 'Toyota Aqua 2018',
      make: 'Toyota',
      model: 'Aqua',
      modelYear: 2018,
      categoryId: 'car',
      thumbnailUrl: null,
      registrationNumber: null,
    },
    provider: {
      id: ID,
      slug: 'sunil-rentals',
      displayName: 'Sunil Rentals',
      platformApproved: true,
    },
    customer: { id: ID, name: 'Nimal Perera', memberSince: '2026-10', emailVerified: true },
    driver: {
      fullName: 'Nimal Perera',
      countryCode: 'LK',
      licenceCountry: 'LK',
      licenceExpiresOn: '2030-01-01',
    },
    pickup: {
      locationName: 'Mirissa office',
      placeName: 'Mirissa',
      districtName: 'Matara',
      address: null,
      instructions: null,
      point: null,
    },
    startsAt: '2026-11-11T18:30:00.000Z',
    endsAt: '2026-11-14T18:30:00.000Z',
    rentalDays: 3,
    price: {
      currency: 'LKR',
      rentalDays: 3,
      basis: 'daily',
      dailyRate: '7500.00',
      weeklyRate: null,
      monthlyRate: null,
      subtotal: '22500.00',
      advancePercentage: '10.00',
      advance: '2250.00',
      balanceDue: '20250.00',
      securityDeposit: '25000.00',
      includedKmPerDay: 100,
      includedKmTotal: 300,
      extraKmRate: '40.00',
      lines: [{ code: 'rental', label: '3 days (daily rate)', amount: '22500.00' }],
    },
    customerNote: null,
    providerNote: null,
    respondBy: '2026-11-02T04:30:00.000Z',
    confirmBy: null,
    acceptedAt: null,
    confirmedAt: null,
    pickedUpAt: null,
    completedAt: null,
    declinedAt: null,
    expiredAt: null,
    cancelledAt: null,
    noShowAt: null,
    declineReason: null,
    declineNote: null,
    cancellationNote: null,
    noShowNote: null,
    confirmationSource: null,
    handover: {
      pickupOdometerKm: null,
      pickupFuelLevel: null,
      pickupNote: null,
      returnOdometerKm: null,
      returnFuelLevel: null,
      returnNote: null,
    },
    contact: { available: false, revealStage: 'confirmed' },
    payment: {
      state: 'not_started',
      advanceAmount: '2250.00',
      currency: 'LKR',
      paidAt: null,
      refundDueAmount: null,
      refundedAt: null,
    },
    allowedActions: ['cancel'],
    events: [],
    createdAt: '2026-11-01T04:30:00.000Z',
    updatedAt: '2026-11-01T04:30:00.000Z',
    ...overrides,
  };
}

describe('api client (bookings)', () => {
  it('requests a public quote without credentials', async () => {
    const { api, calls } = fakeApi(200, {
      vehicleId: ID,
      startsAt: '2026-11-11T18:30:00.000Z',
      endsAt: '2026-11-14T18:30:00.000Z',
      available: true,
      bookable: true,
      reasons: [],
      price: bookingFixture().price,
      quoteToken: 'abc.def',
      expiresAt: '2026-11-01T04:45:00.000Z',
      note: 'n',
    });
    const quote = await api.public.quote(
      'toyota-aqua',
      '2026-11-11T18:30:00.000Z',
      '2026-11-14T18:30:00.000Z',
    );
    expect(quote.bookable).toBe(true);
    const call = callAt(calls, 0);
    expect(call.url).toBe(
      `${BASE}/vehicles/toyota-aqua/quote?startsAt=2026-11-11T18%3A30%3A00.000Z&endsAt=2026-11-14T18%3A30%3A00.000Z`,
    );
    expect(headersOf(call).authorization).toBeUndefined();
  });

  it('creates a booking with the Idempotency-Key header and the bearer token', async () => {
    const { api, calls } = fakeApi(201, bookingFixture());
    const booking = await api.bookings.create(
      'token-1',
      {
        vehicleId: ID,
        startsAt: '2026-11-12T00:00:00+05:30',
        endsAt: '2026-11-15T00:00:00+05:30',
        quoteToken: 'eyJhIjoxfQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
        driver: { fullName: 'Nimal Perera', licenceCountry: 'LK', licenceExpiresOn: '2030-01-01' },
      },
      'key-12345678',
    );
    expect(booking.reference).toBe('SLR-7F3K2Q');
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/bookings`);
    expect(call.init.method).toBe('POST');
    expect(headersOf(call)['idempotency-key']).toBe('key-12345678');
    expect(headersOf(call).authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(call.init.body))).not.toHaveProperty('price');
  });

  it('posts provider transitions to their routes with the version', async () => {
    const { api, calls } = fakeApi(
      200,
      bookingFixture({ status: 'accepted', version: 2, viewer: 'provider' }),
    );
    await api.providerBookings.accept('t', ID, { version: 1, providerNote: 'Blue gate' });
    await api.providerBookings.decline('t', ID, {
      version: 1,
      reason: 'other',
      note: 'Family emergency',
    });
    await api.providerBookings.pickup('t', ID, { version: 3, odometerKm: 45210, fuelLevel: 6 });
    await api.providerBookings.complete('t', ID, { version: 4 });
    await api.providerBookings.noShow('t', ID, { version: 3, note: 'Called three times' });
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      `/providers/me/bookings/${ID}/accept`,
      `/providers/me/bookings/${ID}/decline`,
      `/providers/me/bookings/${ID}/pickup`,
      `/providers/me/bookings/${ID}/return`,
      `/providers/me/bookings/${ID}/no-show`,
    ]);
    expect(JSON.parse(String(callAt(calls, 0).init.body))).toEqual({
      version: 1,
      providerNote: 'Blue gate',
    });
  });

  it('surfaces booking error codes', async () => {
    const { api } = fakeApi(409, {
      error: { code: 'STALE_VERSION', message: 'The booking changed; reload and try again' },
    });
    await expect(api.bookings.cancel('t', ID, { version: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'STALE_VERSION',
    } satisfies Partial<ApiClientError>);
  });

  it('reads an admin booking with its payments and no testing-confirmation action', async () => {
    const { api } = fakeApi(200, {
      ...bookingFixture({
        status: 'confirmed',
        version: 3,
        viewer: 'admin',
        confirmationSource: 'payment',
      }),
      customerEmail: 'nimal@example.com',
      providerEmail: 'sunil@example.com',
      hold: null,
      payments: [],
    });
    const result = await api.admin.getBooking('t', ID);
    expect(result.confirmationSource).toBe('payment');
    expect(result.payments).toEqual([]);
    expect(api.admin).not.toHaveProperty('confirmBookingForTesting');
  });
});
