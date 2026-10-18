import { randomUUID } from 'node:crypto';

import type {
  Booking,
  BookingQuote,
  BookingReviewState,
  CheckoutSession,
  CustomerReview,
  ProviderReview,
} from '@vrp/contracts';

import { call, postForm, query } from './api';
import { API_URL } from './env';

/** Calendar day `daysFromNow` days ahead in Asia/Colombo as `YYYY-MM-DD`. */
export function colomboDay(daysFromNow: number): string {
  const shifted = new Date(Date.now() + 5.5 * 3_600_000);
  const date = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + daysFromNow),
  );
  return date.toISOString().slice(0, 10);
}

/** Midnight Colombo of a `YYYY-MM-DD` day as the instant the API expects. */
export function colomboInstant(day: string): string {
  return `${day}T00:00:00+05:30`;
}

export interface Window {
  startDay: string;
  endDay: string;
  startsAt: string;
  endsAt: string;
}

/** `[start, end)` window `length` days long starting `startOffset` days from now. */
export function rentalWindow(startOffset: number, length = 2): Window {
  const startDay = colomboDay(startOffset);
  const endDay = colomboDay(startOffset + length);
  return { startDay, endDay, startsAt: colomboInstant(startDay), endsAt: colomboInstant(endDay) };
}

export const TEST_DRIVER = {
  fullName: 'Nimal Perera',
  countryCode: 'LK',
  licenceCountry: 'LK',
  licenceExpiresOn: '2031-12-31',
};

export async function getQuote(idOrSlug: string, w: Window): Promise<BookingQuote> {
  const { body } = await call<BookingQuote>(
    'GET',
    `/vehicles/${encodeURIComponent(idOrSlug)}/quote${query({ startsAt: w.startsAt, endsAt: w.endsAt })}`,
  );
  return body;
}

/** Quote + `POST /bookings` with a fresh idempotency key. */
export async function requestBooking(
  customerToken: string,
  vehicleId: string,
  w: Window,
  overrides: Record<string, unknown> = {},
): Promise<Booking> {
  const quote = await getQuote(vehicleId, w);
  if (!quote.bookable || !quote.quoteToken) {
    throw new Error(
      `vehicle not bookable for ${w.startDay}–${w.endDay}: ${quote.reasons.join(', ')}`,
    );
  }
  const { body } = await call<Booking>('POST', '/bookings', {
    token: customerToken,
    headers: { 'idempotency-key': randomUUID() },
    body: {
      vehicleId,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      quoteToken: quote.quoteToken,
      driver: TEST_DRIVER,
      ...overrides,
    },
    expect: 201,
  });
  return body;
}

export async function getBooking(token: string, id: string): Promise<Booking> {
  return (await call<Booking>('GET', `/bookings/${id}`, { token })).body;
}

export async function getProviderBooking(token: string, id: string): Promise<Booking> {
  return (await call<Booking>('GET', `/providers/me/bookings/${id}`, { token })).body;
}

export type ProviderAction = 'accept' | 'decline' | 'cancel' | 'pickup' | 'return' | 'no-show';

/** Provider transition with the current version read from the API (optimistic concurrency). */
export async function providerAction(
  token: string,
  id: string,
  action: ProviderAction,
  body: Record<string, unknown> = {},
): Promise<Booking> {
  const current = await getProviderBooking(token, id);
  const response = await call<Booking>('POST', `/providers/me/bookings/${id}/${action}`, {
    token,
    body: { version: current.version, ...body },
  });
  return response.body;
}

export async function createCheckout(
  customerToken: string,
  bookingId: string,
): Promise<CheckoutSession> {
  return (
    await call<CheckoutSession>('POST', `/bookings/${bookingId}/payments/checkout`, {
      token: customerToken,
      body: {},
    })
  ).body;
}

/**
 * Pays (or fails / cancels) the advance through the fake gateway's own
 * completion endpoint, exactly as its hosted page does when a button is
 * pressed: the gateway signs a notification and feeds it to the notify path.
 */
export async function payAdvanceViaFakeGateway(
  customerToken: string,
  bookingId: string,
  outcome: 'success' | 'cancel' | 'fail' = 'success',
): Promise<Booking> {
  const session = await createCheckout(customerToken, bookingId);
  const f = (name: string) => String(session.fields[name] ?? '');
  const done = await postForm(`${API_URL}/payments/fake/complete`, {
    order_id: f('order_id'),
    amount: f('amount'),
    currency: f('currency'),
    return_url: f('return_url'),
    cancel_url: f('cancel_url'),
    outcome,
  });
  if (done.status !== 303) {
    throw new Error(`fake gateway complete → ${done.status}: ${done.text.slice(0, 200)}`);
  }
  return getBooking(customerToken, bookingId);
}

/** Pickup and return with readings; the booking must be confirmed. */
export async function completeRental(providerToken: string, bookingId: string): Promise<Booking> {
  await providerAction(providerToken, bookingId, 'pickup', { odometerKm: 1000, fuelLevel: 6 });
  return providerAction(providerToken, bookingId, 'return', { odometerKm: 1300, fuelLevel: 5 });
}

export async function reviewState(
  customerToken: string,
  bookingId: string,
): Promise<BookingReviewState> {
  return (
    await call<BookingReviewState>('GET', `/bookings/${bookingId}/review`, { token: customerToken })
  ).body;
}

export async function createReview(
  customerToken: string,
  bookingId: string,
  body: { overallRating: number; comment?: string; vehicleRating?: number },
): Promise<CustomerReview> {
  return (
    await call<CustomerReview>('POST', `/bookings/${bookingId}/review`, {
      token: customerToken,
      body,
      expect: 201,
    })
  ).body;
}

export async function listProviderReviews(providerToken: string): Promise<ProviderReview[]> {
  const { body } = await call<{ data: ProviderReview[] }>('GET', '/providers/me/reviews?limit=50', {
    token: providerToken,
  });
  return body.data;
}

export async function replyToReview(
  providerToken: string,
  reviewId: string,
  reply: string,
): Promise<ProviderReview> {
  return (
    await call<ProviderReview>('POST', `/providers/me/reviews/${reviewId}/reply`, {
      token: providerToken,
      body: { reply },
    })
  ).body;
}
