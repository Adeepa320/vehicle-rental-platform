import type { CustomerReview, Notification, PublicReviewList } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient } from '../api-client';

const BASE = 'http://api.test/api/v1';
const ID = '0192f0a0-0000-7000-8000-000000000123';
const REVIEW_ID = '0192f0a0-0000-7000-8000-000000000456';

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

const publicReview = {
  id: REVIEW_ID,
  overallRating: 5,
  vehicleRating: null,
  serviceRating: 4,
  communicationRating: null,
  comment: 'Great car',
  reviewer: { displayName: 'Nimal P.' },
  providerReply: null,
  providerRepliedAt: null,
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
};

const customerReview: CustomerReview = {
  ...publicReview,
  bookingId: ID,
  status: 'published',
  vehicle: { id: ID, slug: 'toyota-aqua', title: 'Toyota Aqua 2018' },
  canEditUntil: '2026-10-27T10:00:00.000Z',
  editLockReason: null,
};

const notification: Notification = {
  id: ID,
  type: 'booking.accepted',
  title: 'Accepted',
  body: 'Pay the advance',
  linkPath: `/bookings/${ID}`,
  readAt: null,
  createdAt: '2026-10-13T10:00:00.000Z',
};

describe('api client (reviews, notifications, metrics, rates)', () => {
  it('posts a review to the booking route with only the rating fields', async () => {
    const { api, calls } = fakeApi(201, customerReview);
    const review = await api.bookings.createReview('token-1', ID, {
      overallRating: 5,
      serviceRating: 4,
      comment: 'Great car',
    });
    expect(review.reviewer.displayName).toBe('Nimal P.');
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/bookings/${ID}/review`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(String(call.init.body))).toEqual({
      overallRating: 5,
      serviceRating: 4,
      comment: 'Great car',
    });
  });

  it('reads public reviews without credentials and rejects leaked private fields', async () => {
    const list: PublicReviewList = {
      data: [publicReview],
      nextCursor: null,
      summary: { average: '5.0', count: 1 },
    };
    const { api, calls } = fakeApi(200, list);
    const page = await api.public.vehicleReviews('toyota-aqua', { limit: 5 });
    expect(page.summary).toEqual({ average: '5.0', count: 1 });
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/vehicles/toyota-aqua/reviews?limit=5`);
    expect((call.init.headers as Record<string, string>).authorization).toBeUndefined();

    const bad = fakeApi(200, { ...list, summary: { average: '4.55', count: 1 } });
    await expect(bad.api.public.vehicleReviews('toyota-aqua')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('calls the notification routes with the bearer token', async () => {
    const { api, calls } = fakeApi(200, { data: [notification], nextCursor: null });
    await api.notifications.list('t', { unreadOnly: true, limit: 10 });
    expect(callAt(calls, 0).url).toBe(`${BASE}/notifications?limit=10&unreadOnly=true`);

    const read = fakeApi(200, { ...notification, readAt: '2026-10-13T11:00:00.000Z' });
    const updated = await read.api.notifications.markRead('t', ID);
    expect(updated.readAt).toBe('2026-10-13T11:00:00.000Z');
    expect(callAt(read.calls, 0).url).toBe(`${BASE}/notifications/${ID}/read`);
    expect(callAt(read.calls, 0).init.method).toBe('POST');

    const unread = fakeApi(200, { unread: 3 });
    expect((await unread.api.notifications.unreadCount('t')).unread).toBe(3);
    const all = fakeApi(200, { marked: 2 });
    expect((await all.api.notifications.markAllRead('t')).marked).toBe(2);
    expect(callAt(all.calls, 0).url).toBe(`${BASE}/notifications/read-all`);
  });

  it('rejects notification links that are not application-relative', async () => {
    const { api } = fakeApi(200, {
      data: [{ ...notification, linkPath: 'https://evil.example/x' }],
      nextCursor: null,
    });
    await expect(api.notifications.list('t')).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('posts provider replies and admin moderation to their routes', async () => {
    const providerView = {
      ...publicReview,
      status: 'published',
      booking: { id: ID, reference: 'SLR-7F3K2Q' },
      vehicle: { id: ID, slug: 'toyota-aqua', title: 'Toyota Aqua 2018' },
    };
    const { api, calls } = fakeApi(200, { ...providerView, providerReply: 'Thanks!' });
    const replied = await api.providerReviews.reply('t', REVIEW_ID, { reply: 'Thanks!' });
    expect(replied.providerReply).toBe('Thanks!');
    expect(callAt(calls, 0).url).toBe(`${BASE}/providers/me/reviews/${REVIEW_ID}/reply`);

    const admin = fakeApi(200, {
      ...providerView,
      status: 'hidden',
      customer: { id: ID, name: 'Nimal Perera', email: 'nimal@example.com' },
      provider: { id: ID, displayName: 'Sunil Rentals' },
      hiddenAt: '2026-10-13T12:00:00.000Z',
      hiddenReason: 'Contains a phone number',
      hiddenBy: ID,
    });
    const hidden = await admin.api.admin.hideReview('t', REVIEW_ID, {
      reason: 'Contains a phone number',
    });
    expect(hidden.status).toBe('hidden');
    expect(callAt(admin.calls, 0).url).toBe(`${BASE}/admin/reviews/${REVIEW_ID}/hide`);
    expect(JSON.parse(String(callAt(admin.calls, 0).init.body))).toEqual({
      reason: 'Contains a phone number',
    });
  });

  it('reads provider metrics and indicative exchange rates', async () => {
    const { api } = fakeApi(200, {
      completedBookings: 4,
      acceptance: { ratePercent: 67, accepted: 2, decided: 3 },
      responseTime: { averageMinutes: 42, sample: 3 },
      rating: { average: '4.5', count: 2 },
      minimumSample: 3,
    });
    expect((await api.providers.metrics('t')).acceptance.ratePercent).toBe(67);
    const rates = fakeApi(200, {
      base: 'LKR',
      available: false,
      asOf: null,
      source: null,
      rates: {},
      disclaimer: 'Indicative only.',
    });
    expect((await rates.api.reference.exchangeRates()).available).toBe(false);
  });
});
