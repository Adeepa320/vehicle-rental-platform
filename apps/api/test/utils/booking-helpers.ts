import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Booking, BookingQuote } from '@vrp/contracts';
import request, { type Response } from 'supertest';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const TEST_DRIVER = {
  fullName: 'Nimal Perera',
  countryCode: 'LK',
  licenceCountry: 'LK',
  licenceExpiresOn: '2031-12-31',
};

export async function quoteFor(
  app: NestExpressApplication,
  idOrSlug: string,
  startsAt: string,
  endsAt: string,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/vehicles/${encodeURIComponent(idOrSlug)}/quote`)
    .query({ startsAt, endsAt })
    .expect(expected);
}

export async function createBooking(
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
  expected?: number,
): Promise<Response> {
  let req = request(app.getHttpServer()).post('/api/v1/bookings').set(auth(token));
  if (idempotencyKey !== undefined) req = req.set('Idempotency-Key', idempotencyKey);
  const response = await req.send(body);
  if (expected !== undefined && response.status !== expected) {
    throw new Error(
      `POST /bookings: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return response;
}

/** Quotes and requests a booking for `[startsAt, endsAt)`; returns the created booking. */
export async function requestBooking(
  app: NestExpressApplication,
  token: string,
  vehicleId: string,
  startsAt: string,
  endsAt: string,
  overrides: Record<string, unknown> = {},
): Promise<Booking> {
  const quote = (await quoteFor(app, vehicleId, startsAt, endsAt)).body as BookingQuote;
  if (!quote.bookable || !quote.quoteToken) {
    throw new Error(`vehicle not bookable for ${startsAt}–${endsAt}: ${quote.reasons.join(', ')}`);
  }
  const response = await createBooking(
    app,
    token,
    {
      vehicleId,
      startsAt,
      endsAt,
      quoteToken: quote.quoteToken,
      driver: TEST_DRIVER,
      ...overrides,
    },
    randomUUID(),
    201,
  );
  return response.body as Booking;
}

export type ProviderBookingAction =
  'accept' | 'decline' | 'cancel' | 'pickup' | 'return' | 'no-show';

export async function providerBookingAction(
  app: NestExpressApplication,
  token: string,
  id: string,
  action: ProviderBookingAction,
  body: Record<string, unknown>,
  expected?: number,
): Promise<Response> {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/providers/me/bookings/${id}/${action}`)
    .set(auth(token))
    .send(body);
  if (expected !== undefined && response.status !== expected) {
    throw new Error(
      `${action} ${id}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return response;
}

export async function getBooking(
  app: NestExpressApplication,
  token: string,
  id: string,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/bookings/${id}`)
    .set(auth(token))
    .expect(expected);
}

export async function getProviderBooking(
  app: NestExpressApplication,
  token: string,
  id: string,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/providers/me/bookings/${id}`)
    .set(auth(token))
    .expect(expected);
}

/**
 * Hands out non-overlapping day windows for one vehicle so tests never collide
 * on holds: each call returns `[startsAt, endsAt)` `length` days long, starting
 * after the previous window (with a one-day gap).
 */
export function windowAllocator(
  colomboMidnight: (days: number) => string,
  firstDay = 10,
): (length?: number) => { startsAt: string; endsAt: string; startDay: number } {
  let day = firstDay;
  return (length = 2) => {
    const startDay = day;
    day += length + 1;
    return {
      startsAt: colomboMidnight(startDay),
      endsAt: colomboMidnight(startDay + length),
      startDay,
    };
  };
}
