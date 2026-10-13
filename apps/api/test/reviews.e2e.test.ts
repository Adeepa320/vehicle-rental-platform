import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  isSafeNotificationLink,
  type AdminReview,
  type AdminReviewList,
  type Booking,
  type BookingReviewState,
  type CustomerReview,
  type Notification,
  type ProviderMetrics,
  type ProviderReviewList,
  type PublicReviewList,
  type PublicVehicleDetail,
  type Vehicle,
  type VehicleSearchResponse,
} from '@vrp/contracts';
import { auditEvents, bookings, reviews, runMigrations, type DatabaseHandle } from '@vrp/database';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, findEmail, takeAllEmails } from './utils/auth-helpers';
import {
  getBooking,
  providerBookingAction,
  requestBooking,
  windowAllocator,
} from './utils/booking-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { payAdvance } from './utils/payment-helpers';
import {
  newAdmin,
  newVerifiedUser,
  seedReference,
  type ApplicantSession,
  type ReferenceIds,
} from './utils/provider-helpers';
import {
  approvedProvider,
  approvedVehicle,
  colomboMidnight,
  newLocation,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping reviews e2e tests');

const SCOPE = 'rev';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 86_400_000;

describe.skipIf(!url)(
  'reviews (customer review, provider reply, admin moderation, aggregates)',
  () => {
    let app: NestExpressApplication;
    let handle: DatabaseHandle;
    let refs: ReferenceIds;
    let admin: ApplicantSession;
    let provider: ProviderSession;
    let otherProvider: ProviderSession;
    let customerA: ApplicantSession;
    let customerB: ApplicantSession;
    let vehicle1: Vehicle;
    let vehicle2: Vehicle;
    let vehicle3: Vehicle;
    const nextWindow = windowAllocator(colomboMidnight, 10);
    const ctx: { reviewA?: CustomerReview; bookingA?: Booking } = {};

    const api = () => request(app.getHttpServer());
    const postReview = (token: string, bookingId: string, body: object) =>
      api().post(`/api/v1/bookings/${bookingId}/review`).set(auth(token)).send(body);
    const putReview = (token: string, bookingId: string, body: object) =>
      api().put(`/api/v1/bookings/${bookingId}/review`).set(auth(token)).send(body);
    const reviewState = (token: string, bookingId: string) =>
      api().get(`/api/v1/bookings/${bookingId}/review`).set(auth(token));
    const publicReviews = (slug: string, query = '') =>
      api().get(`/api/v1/vehicles/${slug}/reviews${query}`);
    const vehicleDetail = (slug: string) => api().get(`/api/v1/vehicles/${slug}`);
    const providerReviews = (token: string) =>
      api().get('/api/v1/providers/me/reviews').set(auth(token));
    const reply = (token: string, id: string, body: object) =>
      api().post(`/api/v1/providers/me/reviews/${id}/reply`).set(auth(token)).send(body);
    const adminHide = (token: string, id: string, body: object) =>
      api().post(`/api/v1/admin/reviews/${id}/hide`).set(auth(token)).send(body);
    const adminUnhide = (token: string, id: string, body: object) =>
      api().post(`/api/v1/admin/reviews/${id}/unhide`).set(auth(token)).send(body);
    const feedOf = async (token: string): Promise<Notification[]> =>
      (
        (await api().get('/api/v1/notifications?limit=50').set(auth(token)).expect(200)).body as {
          data: Notification[];
        }
      ).data;

    /** request → accept → pay (fake gateway) → pickup → return. */
    async function completed(
      customer: ApplicantSession,
      vehicleId: string,
      length = 2,
    ): Promise<Booking> {
      const w = nextWindow(length);
      const b = await requestBooking(
        app,
        customer.body.accessToken,
        vehicleId,
        w.startsAt,
        w.endsAt,
      );
      await providerBookingAction(
        app,
        provider.body.accessToken,
        b.id,
        'accept',
        { version: 1 },
        200,
      );
      await payAdvance(app, customer.body.accessToken, b.id);
      await providerBookingAction(
        app,
        provider.body.accessToken,
        b.id,
        'pickup',
        { version: 3 },
        200,
      );
      const done = await providerBookingAction(
        app,
        provider.body.accessToken,
        b.id,
        'return',
        { version: 4 },
        200,
      );
      return done.body as Booking;
    }

    beforeAll(async () => {
      await runMigrations(url as string);
      app = await createTestApp({ DATABASE_URL: url as string });
      handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
      refs = await seedReference(app);
      admin = await newAdmin(app, nextEmail());
      provider = await approvedProvider(app, nextEmail(), refs, admin, 'Review Rentals Mirissa');
      otherProvider = await approvedProvider(app, nextEmail(), refs, admin, 'Other Review Rentals');
      const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
      vehicle1 = await approvedVehicle(
        app,
        provider.body.accessToken,
        admin.body.accessToken,
        locationId,
        {
          registrationNumber: 'WP RV-7001',
        },
      );
      vehicle2 = await approvedVehicle(
        app,
        provider.body.accessToken,
        admin.body.accessToken,
        locationId,
        {
          registrationNumber: 'WP RV-7002',
          title: 'Honda Fit 2019 – automatic hybrid',
          make: 'Honda',
          model: 'Fit',
          modelYear: 2019,
        },
      );
      const otherLocationId = (await newLocation(app, otherProvider.body.accessToken, refs)).id;
      vehicle3 = await approvedVehicle(
        app,
        otherProvider.body.accessToken,
        admin.body.accessToken,
        otherLocationId,
        { registrationNumber: 'WP RV-7003' },
      );
      customerA = await newVerifiedUser(app, nextEmail());
      customerB = await newVerifiedUser(app, nextEmail());
      await takeAllEmails(app);
    });

    afterAll(async () => {
      await cleanupUsers(app, SCOPE);
      await app.close();
    });

    it('refuses reviews before completion, from other customers and from providers', async () => {
      const w = nextWindow(2);
      const open = await requestBooking(
        app,
        customerA.body.accessToken,
        vehicle1.id,
        w.startsAt,
        w.endsAt,
      );
      const state = await reviewState(customerA.body.accessToken, open.id).expect(200);
      expect(state.body).toMatchObject({
        bookingId: open.id,
        eligible: false,
        reason: 'not_completed',
        windowClosesAt: null,
        review: null,
      });
      const early = await postReview(customerA.body.accessToken, open.id, { overallRating: 5 });
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');
      await postReview(customerB.body.accessToken, open.id, { overallRating: 5 }).expect(404);
      await reviewState(customerB.body.accessToken, open.id).expect(404);
      await postReview(provider.body.accessToken, open.id, { overallRating: 5 }).expect(404);
      await providerBookingAction(
        app,
        provider.body.accessToken,
        open.id,
        'accept',
        { version: 1 },
        200,
      );
      expect(
        (await postReview(customerA.body.accessToken, open.id, { overallRating: 5 })).status,
      ).toBe(409);
    });

    it('publishes one validated review per completed booking and notifies the provider', async () => {
      const booking = await completed(customerA, vehicle1.id);
      ctx.bookingA = booking;
      await takeAllEmails(app);

      expect(
        (await postReview(customerA.body.accessToken, booking.id, { overallRating: 6 })).status,
      ).toBe(400);
      expect(
        (await postReview(customerA.body.accessToken, booking.id, { overallRating: 0 })).status,
      ).toBe(400);
      expect(
        (
          await postReview(customerA.body.accessToken, booking.id, {
            overallRating: 5,
            customerUserId: customerB.userId,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await postReview(customerA.body.accessToken, booking.id, {
            overallRating: 5,
            status: 'hidden',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await postReview(customerA.body.accessToken, booking.id, {
            overallRating: 5,
            comment: 'x'.repeat(1001),
          })
        ).status,
      ).toBe(400);

      const comment = 'Clean car, <script>alert(1)</script> friendly handover';
      const created = await postReview(customerA.body.accessToken, booking.id, {
        overallRating: 5,
        vehicleRating: 5,
        communicationRating: 4,
        comment,
      }).expect(201);
      const review = created.body as CustomerReview;
      expect(review).toMatchObject({
        bookingId: booking.id,
        status: 'published',
        overallRating: 5,
        vehicleRating: 5,
        serviceRating: null,
        communicationRating: 4,
        comment,
        reviewer: { displayName: 'Nimal P.' },
        providerReply: null,
        vehicle: { id: vehicle1.id, slug: vehicle1.slug },
      });
      expect(review.canEditUntil).not.toBeNull();
      ctx.reviewA = review;

      const dup = await postReview(customerA.body.accessToken, booking.id, { overallRating: 4 });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('ALREADY_REVIEWED');
      expect((await reviewState(customerA.body.accessToken, booking.id)).body).toMatchObject({
        eligible: false,
        reason: 'already_reviewed',
        review: { id: review.id },
      });

      const mine = (await getBooking(app, customerA.body.accessToken, booking.id)).body as Booking;
      const event = mine.events.find((e) => e.action === 'booking.reviewed');
      expect(event?.metadata).toEqual({ overallRating: 5 });

      const mails = await takeAllEmails(app);
      const mail = findEmail(mails, provider.email, 'New review');
      expect(mail?.text).toContain('Nimal P.');
      expect(mail?.text).not.toContain(customerA.email);
      expect(mail?.html).not.toContain('<script>');
      const providerFeed = await feedOf(provider.body.accessToken);
      expect(
        providerFeed.find(
          (n) => n.type === 'review.received' && n.linkPath === '/provider/reviews',
        ),
      ).toBeDefined();

      const pub = (await publicReviews(vehicle1.slug as string).expect(200))
        .body as PublicReviewList;
      expect(pub.summary).toEqual({ average: '5.0', count: 1 });
      expect(pub.data).toHaveLength(1);
      expect(pub.data[0]).toMatchObject({
        id: review.id,
        comment,
        reviewer: { displayName: 'Nimal P.' },
        providerReply: null,
      });
      const detail = (await vehicleDetail(vehicle1.slug as string).expect(200))
        .body as PublicVehicleDetail;
      expect(detail.rating).toEqual({ average: '5.0', count: 1 });
      expect(detail.provider.rating).toEqual({ average: '5.0', count: 1 });
      const search = (await api().get('/api/v1/vehicles/search?limit=50').expect(200))
        .body as VehicleSearchResponse;
      expect(search.data.find((c) => c.id === vehicle1.id)?.rating).toEqual({
        average: '5.0',
        count: 1,
      });
      expect(search.data.find((c) => c.id === vehicle3.id)?.rating).toEqual({
        average: null,
        count: 0,
      });
    });

    it('public review JSON carries no customer, booking or moderation data', async () => {
      const booking = ctx.bookingA as Booking;
      const json = JSON.stringify((await publicReviews(vehicle1.slug as string).expect(200)).body);
      for (const forbidden of [
        customerA.email,
        customerA.userId,
        booking.id,
        booking.reference,
        'Perera',
        'customerUserId',
        'bookingId',
        'hiddenReason',
        'status',
        'email',
        'phone',
      ]) {
        expect(json, forbidden).not.toContain(forbidden);
      }
      const detailJson = JSON.stringify((await vehicleDetail(vehicle1.slug as string)).body);
      for (const forbidden of [
        customerA.email,
        booking.id,
        booking.reference,
        'revenue',
        'payment',
      ]) {
        expect(detailJson, forbidden).not.toContain(forbidden);
      }
    });

    it('lets the customer edit while the window is open; refuses once it has closed', async () => {
      const booking = ctx.bookingA as Booking;
      const edited = (
        await putReview(customerA.body.accessToken, booking.id, {
          overallRating: 3,
          comment: 'Edited: decent car',
        }).expect(200)
      ).body as CustomerReview;
      expect(edited).toMatchObject({
        overallRating: 3,
        vehicleRating: null,
        comment: 'Edited: decent car',
      });
      expect(
        ((await publicReviews(vehicle1.slug as string)).body as PublicReviewList).summary,
      ).toEqual({
        average: '3.0',
        count: 1,
      });

      await handle.db
        .update(bookings)
        .set({ completedAt: new Date(Date.now() - 15 * DAY) })
        .where(eq(bookings.id, booking.id));
      const closed = await putReview(customerA.body.accessToken, booking.id, { overallRating: 4 });
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe('REVIEW_WINDOW_CLOSED');
      expect(
        ((await reviewState(customerA.body.accessToken, booking.id)).body as BookingReviewState)
          .review?.canEditUntil,
      ).toBeNull();

      const stale = await completed(customerA, vehicle1.id);
      await handle.db
        .update(bookings)
        .set({ completedAt: new Date(Date.now() - 15 * DAY) })
        .where(eq(bookings.id, stale.id));
      const late = await postReview(customerA.body.accessToken, stale.id, { overallRating: 5 });
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('REVIEW_WINDOW_CLOSED');
      expect((await reviewState(customerA.body.accessToken, stale.id)).body).toMatchObject({
        eligible: false,
        reason: 'window_closed',
        review: null,
      });
    });

    it('lets the provider reply once, only to published reviews of its own vehicles', async () => {
      const review = ctx.reviewA as CustomerReview;
      await takeAllEmails(app);
      await reply(otherProvider.body.accessToken, review.id, { reply: 'Thanks' }).expect(404);
      await reply(customerA.body.accessToken, review.id, { reply: 'Thanks' }).expect(403);
      expect((await reply(provider.body.accessToken, review.id, { reply: '' })).status).toBe(400);
      const replied = await reply(provider.body.accessToken, review.id, {
        reply: 'Thank you Nimal, come again! <b>',
      }).expect(200);
      expect(replied.body).toMatchObject({
        id: review.id,
        providerReply: 'Thank you Nimal, come again! <b>',
        booking: { id: (ctx.bookingA as Booking).id },
      });
      expect(replied.body.providerRepliedAt).not.toBeNull();
      const again = await reply(provider.body.accessToken, review.id, { reply: 'Again' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ALREADY_REPLIED');

      const pub = (await publicReviews(vehicle1.slug as string)).body as PublicReviewList;
      expect(pub.data[0]?.providerReply).toBe('Thank you Nimal, come again! <b>');
      const mails = await takeAllEmails(app);
      expect(findEmail(mails, customerA.email, 'replied to your review')?.html).toContain(
        '&lt;b&gt;',
      );
      const feed = await feedOf(customerA.body.accessToken);
      expect(
        feed.find(
          (n) =>
            n.type === 'review.replied' &&
            n.linkPath === `/bookings/${(ctx.bookingA as Booking).id}/review`,
        ),
      ).toBeDefined();

      const inbox = (await providerReviews(provider.body.accessToken).expect(200))
        .body as ProviderReviewList;
      expect(inbox.data.find((r) => r.id === review.id)).toMatchObject({
        status: 'published',
        booking: { reference: (ctx.bookingA as Booking).reference },
        vehicle: { id: vehicle1.id },
      });
      expect(JSON.stringify(inbox)).not.toContain(customerA.email);
      expect(JSON.stringify(inbox)).not.toContain(customerA.userId);
      await providerReviews(customerA.body.accessToken).expect(403);
    });

    it('admin hides with a reason and unhides; audited, customer notified, aggregates follow', async () => {
      const review = ctx.reviewA as CustomerReview;
      const booking = ctx.bookingA as Booking;
      await takeAllEmails(app);
      await adminHide(provider.body.accessToken, review.id, { reason: 'Not my customer' }).expect(
        403,
      );
      await adminHide(customerA.body.accessToken, review.id, { reason: 'Hide myself' }).expect(403);
      expect((await adminHide(admin.body.accessToken, review.id, { reason: 'bad' })).status).toBe(
        400,
      );
      expect((await adminHide(admin.body.accessToken, review.id, {})).status).toBe(400);

      const hidden = (
        await adminHide(admin.body.accessToken, review.id, {
          reason: 'Contains a phone number',
        }).expect(200)
      ).body as AdminReview;
      expect(hidden).toMatchObject({
        status: 'hidden',
        hiddenReason: 'Contains a phone number',
        hiddenBy: admin.userId,
        customer: { email: customerA.email },
        provider: { id: provider.providerId },
      });
      expect(
        ((await publicReviews(vehicle1.slug as string)).body as PublicReviewList).data,
      ).toEqual([]);
      expect(
        ((await publicReviews(vehicle1.slug as string)).body as PublicReviewList).summary,
      ).toEqual({
        average: null,
        count: 0,
      });
      expect(
        ((await vehicleDetail(vehicle1.slug as string)).body as PublicVehicleDetail).rating,
      ).toEqual({
        average: null,
        count: 0,
      });
      const inbox = (await providerReviews(provider.body.accessToken)).body as ProviderReviewList;
      expect(inbox.data.find((r) => r.id === review.id)?.status).toBe('hidden');
      expect(JSON.stringify(inbox)).not.toContain('Contains a phone number');
      const state = (await reviewState(customerA.body.accessToken, booking.id))
        .body as BookingReviewState;
      expect(state.review).toMatchObject({ status: 'hidden', canEditUntil: null });
      expect(JSON.stringify(state)).not.toContain('Contains a phone number');
      expect(
        (await putReview(customerA.body.accessToken, booking.id, { overallRating: 5 })).status,
      ).toBe(409);
      expect(
        (await adminHide(admin.body.accessToken, review.id, { reason: 'Hide it again' })).status,
      ).toBe(409);

      const audited = await handle.db
        .select({ action: auditEvents.action, reason: auditEvents.reason })
        .from(auditEvents)
        .where(and(eq(auditEvents.targetType, 'review'), eq(auditEvents.targetId, review.id)));
      expect(audited).toEqual([{ action: 'review.hidden', reason: 'Contains a phone number' }]);
      let mails = await takeAllEmails(app);
      expect(findEmail(mails, customerA.email, 'has been hidden')?.text).toContain(
        'Contains a phone number',
      );
      expect(
        (await feedOf(customerA.body.accessToken)).some((n) => n.type === 'review.hidden'),
      ).toBe(true);

      const restored = (
        await adminUnhide(admin.body.accessToken, review.id, {
          note: 'Reviewed; the number was the shop line',
        }).expect(200)
      ).body as AdminReview;
      expect(restored).toMatchObject({
        status: 'published',
        hiddenReason: null,
        hiddenAt: null,
        hiddenBy: null,
      });
      expect(
        ((await publicReviews(vehicle1.slug as string)).body as PublicReviewList).summary,
      ).toEqual({
        average: '3.0',
        count: 1,
      });
      expect((await adminUnhide(admin.body.accessToken, review.id, {})).status).toBe(409);
      const actions = (
        await handle.db
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(and(eq(auditEvents.targetType, 'review'), eq(auditEvents.targetId, review.id)))
      ).map((a) => a.action);
      expect(actions).toEqual(['review.hidden', 'review.unhidden']);
      mails = await takeAllEmails(app);
      expect(findEmail(mails, customerA.email, 'visible again')).toBeDefined();
      expect(
        (await feedOf(customerA.body.accessToken)).some((n) => n.type === 'review.unhidden'),
      ).toBe(true);

      const list = (
        await api()
          .get('/api/v1/admin/reviews?status=hidden')
          .set(auth(admin.body.accessToken))
          .expect(200)
      ).body as AdminReviewList;
      expect(list.data.find((r) => r.id === review.id)).toBeUndefined();
      const all = (
        await api().get('/api/v1/admin/reviews').set(auth(admin.body.accessToken)).expect(200)
      ).body as AdminReviewList;
      expect(all.data.find((r) => r.id === review.id)?.customer.email).toBe(customerA.email);
      await api().get('/api/v1/admin/reviews').set(auth(provider.body.accessToken)).expect(403);
    });

    it('aggregates are per vehicle, span the provider, round once in SQL and paginate stably', async () => {
      const b2 = await completed(customerB, vehicle2.id);
      await postReview(customerB.body.accessToken, b2.id, { overallRating: 2 }).expect(201);
      const b3 = await completed(customerB, vehicle1.id);
      await postReview(customerB.body.accessToken, b3.id, {
        overallRating: 5,
        comment: 'Second rental, great',
      }).expect(201);

      const d1 = (await vehicleDetail(vehicle1.slug as string)).body as PublicVehicleDetail;
      const d2 = (await vehicleDetail(vehicle2.slug as string)).body as PublicVehicleDetail;
      const d3 = (await vehicleDetail(vehicle3.slug as string)).body as PublicVehicleDetail;
      expect(d1.rating).toEqual({ average: '4.0', count: 2 }); // (3 + 5) / 2
      expect(d2.rating).toEqual({ average: '2.0', count: 1 });
      expect(d3.rating).toEqual({ average: null, count: 0 });
      expect(d1.provider.rating).toEqual({ average: '3.3', count: 3 }); // (3 + 2 + 5) / 3 = 3.33…
      expect(d2.provider.rating).toEqual({ average: '3.3', count: 3 });
      expect(d3.provider.rating).toEqual({ average: null, count: 0 });

      const metrics = (
        await api()
          .get('/api/v1/providers/me/metrics')
          .set(auth(provider.body.accessToken))
          .expect(200)
      ).body as ProviderMetrics;
      expect(metrics.rating).toEqual({ average: '3.3', count: 3 });
      expect(metrics.completedBookings).toBe(4);
      expect(metrics.acceptance).toEqual({ ratePercent: 100, accepted: 5, decided: 5 });
      expect(metrics.responseTime.sample).toBe(5);
      expect(metrics.responseTime.averageMinutes).toBeGreaterThanOrEqual(0);

      const page1 = (await publicReviews(vehicle1.slug as string, '?limit=1').expect(200))
        .body as PublicReviewList;
      expect(page1.data).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = (
        await publicReviews(
          vehicle1.slug as string,
          `?limit=1&cursor=${encodeURIComponent(page1.nextCursor as string)}`,
        ).expect(200)
      ).body as PublicReviewList;
      expect(page2.data).toHaveLength(1);
      expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
      expect(page2.nextCursor).toBeNull();
      expect((await publicReviews(vehicle1.slug as string, '?cursor=garbage')).status).toBe(400);
      await publicReviews('no-such-vehicle').expect(404);
    });

    it('provider metrics ignore automatic declines, suppress tiny samples and expose no private data', async () => {
      const zero = (
        await api()
          .get('/api/v1/providers/me/metrics')
          .set(auth(otherProvider.body.accessToken))
          .expect(200)
      ).body as ProviderMetrics;
      expect(zero).toMatchObject({
        completedBookings: 0,
        acceptance: { ratePercent: null, accepted: 0, decided: 0 },
        responseTime: { averageMinutes: null, sample: 0 },
        rating: { average: null, count: 0 },
      });

      const w = nextWindow(2);
      const r1 = await requestBooking(
        app,
        customerA.body.accessToken,
        vehicle3.id,
        w.startsAt,
        w.endsAt,
      );
      const r2 = await requestBooking(
        app,
        customerB.body.accessToken,
        vehicle3.id,
        w.startsAt,
        w.endsAt,
      );
      await providerBookingAction(
        app,
        otherProvider.body.accessToken,
        r1.id,
        'accept',
        { version: 1 },
        200,
      );
      expect((await getBooking(app, customerB.body.accessToken, r2.id)).body.status).toBe(
        'declined',
      );
      const w3 = nextWindow(2);
      const r3 = await requestBooking(
        app,
        customerA.body.accessToken,
        vehicle3.id,
        w3.startsAt,
        w3.endsAt,
      );
      await providerBookingAction(
        app,
        otherProvider.body.accessToken,
        r3.id,
        'decline',
        { version: 1, reason: 'other', note: 'Family emergency this week' },
        200,
      );
      let metrics = (
        await api()
          .get('/api/v1/providers/me/metrics')
          .set(auth(otherProvider.body.accessToken))
          .expect(200)
      ).body as ProviderMetrics;
      // 1 accepted + 1 manual decline; the automatic decline of r2 does not count.
      expect(metrics.acceptance).toEqual({ ratePercent: null, accepted: 1, decided: 2 });
      expect(metrics.responseTime).toEqual({ averageMinutes: null, sample: 2 });

      const w4 = nextWindow(2);
      const r4 = await requestBooking(
        app,
        customerB.body.accessToken,
        vehicle3.id,
        w4.startsAt,
        w4.endsAt,
      );
      await providerBookingAction(
        app,
        otherProvider.body.accessToken,
        r4.id,
        'accept',
        { version: 1 },
        200,
      );
      metrics = (
        await api()
          .get('/api/v1/providers/me/metrics')
          .set(auth(otherProvider.body.accessToken))
          .expect(200)
      ).body as ProviderMetrics;
      expect(metrics.acceptance).toEqual({ ratePercent: 67, accepted: 2, decided: 3 });
      expect(metrics.responseTime.sample).toBe(3);
      expect(typeof metrics.responseTime.averageMinutes).toBe('number');

      const detail = (await vehicleDetail(vehicle3.slug as string)).body as PublicVehicleDetail;
      expect(detail.provider.metrics.acceptance.ratePercent).toBe(67);
      const json = JSON.stringify(detail.provider);
      for (const forbidden of [
        customerA.email,
        customerB.email,
        r1.id,
        r3.id,
        'Family emergency',
        'advance',
        'amount',
      ]) {
        expect(json, forbidden).not.toContain(forbidden);
      }
      await api()
        .get('/api/v1/providers/me/metrics')
        .set(auth(customerA.body.accessToken))
        .expect(403);
    });

    it('locks a review for customer editing once the provider has replied, deterministically under a race', async () => {
      const b = await completed(customerB, vehicle1.id);
      const review = (
        await postReview(customerB.body.accessToken, b.id, {
          overallRating: 4,
          comment: 'Solid car',
        }).expect(201)
      ).body as CustomerReview;
      expect(review).toMatchObject({ canEditUntil: expect.any(String), editLockReason: null });

      // 1. Editing works before any reply.
      const edited = (
        await putReview(customerB.body.accessToken, b.id, {
          overallRating: 3,
          comment: 'Solid car, slow pickup',
        }).expect(200)
      ).body as CustomerReview;
      expect(edited).toMatchObject({ overallRating: 3, editLockReason: null });

      // 2. The provider replies.
      await reply(provider.body.accessToken, review.id, { reply: 'Sorry about the wait' }).expect(
        200,
      );

      // 3–5. The customer's edit is refused and nothing on the row changes.
      const locked = await putReview(customerB.body.accessToken, b.id, {
        overallRating: 5,
        comment: 'Changed my mind',
      });
      expect(locked.status).toBe(409);
      expect(locked.body.error.code).toBe('REVIEW_LOCKED_AFTER_REPLY');
      const [row] = await handle.db.select().from(reviews).where(eq(reviews.id, review.id));
      expect(row).toMatchObject({
        overallRating: 3,
        comment: 'Solid car, slow pickup',
        providerReply: 'Sorry about the wait',
        status: 'published',
      });
      const state = (await reviewState(customerB.body.accessToken, b.id))
        .body as BookingReviewState;
      expect(state.review).toMatchObject({
        canEditUntil: null,
        editLockReason: 'provider_replied',
        providerReply: 'Sorry about the wait',
      });

      // 6. Another customer still cannot touch it; 10. public output shows the final text and the reply.
      await putReview(customerA.body.accessToken, b.id, { overallRating: 1 }).expect(404);
      const pub = (await publicReviews(vehicle1.slug as string, '?limit=50'))
        .body as PublicReviewList;
      expect(pub.data.find((r) => r.id === review.id)).toMatchObject({
        overallRating: 3,
        comment: 'Solid car, slow pickup',
        providerReply: 'Sorry about the wait',
        reviewer: { displayName: 'Nimal P.' },
      });
      expect(JSON.stringify(pub)).not.toContain(customerB.email);

      // 7. Hide / unhide keeps the reply and the lock.
      await adminHide(admin.body.accessToken, review.id, { reason: 'Checking a complaint' }).expect(
        200,
      );
      expect(
        ((await reviewState(customerB.body.accessToken, b.id)).body as BookingReviewState).review
          ?.editLockReason,
      ).toBe('hidden');
      expect((await putReview(customerB.body.accessToken, b.id, { overallRating: 5 })).status).toBe(
        409,
      );
      await adminUnhide(admin.body.accessToken, review.id, {}).expect(200);
      const after = (await reviewState(customerB.body.accessToken, b.id))
        .body as BookingReviewState;
      expect(after.review).toMatchObject({
        status: 'published',
        editLockReason: 'provider_replied',
        providerReply: 'Sorry about the wait',
        canEditUntil: null,
      });
      expect(
        (await putReview(customerB.body.accessToken, b.id, { overallRating: 5 })).body.error.code,
      ).toBe('REVIEW_LOCKED_AFTER_REPLY');

      // Race: a reply and an edit fired together serialise on the review row (FOR UPDATE in both
      // transactions); whichever commits first decides, and the result is one of two consistent states.
      const b2 = await completed(customerB, vehicle1.id);
      const r2 = (
        await postReview(customerB.body.accessToken, b2.id, {
          overallRating: 2,
          comment: 'First version',
        }).expect(201)
      ).body as CustomerReview;
      const [replyRes, editRes] = await Promise.all([
        reply(provider.body.accessToken, r2.id, { reply: 'Replying now' }),
        putReview(customerB.body.accessToken, b2.id, {
          overallRating: 5,
          comment: 'Second version',
        }),
      ]);
      expect(replyRes.status).toBe(200);
      const [raced] = await handle.db.select().from(reviews).where(eq(reviews.id, r2.id));
      if (editRes.status === 200) {
        // The edit committed first; the reply answered the edited text.
        expect(raced).toMatchObject({
          overallRating: 5,
          comment: 'Second version',
          providerReply: 'Replying now',
        });
      } else {
        expect(editRes.status).toBe(409);
        expect(editRes.body.error.code).toBe('REVIEW_LOCKED_AFTER_REPLY');
        expect(raced).toMatchObject({
          overallRating: 2,
          comment: 'First version',
          providerReply: 'Replying now',
        });
      }
      const later = await putReview(customerB.body.accessToken, b2.id, { overallRating: 1 });
      expect(later.status).toBe(409);
      expect(later.body.error.code).toBe('REVIEW_LOCKED_AFTER_REPLY');

      // 11. Aggregates reflect exactly the persisted published rows.
      const summary = ((await publicReviews(vehicle1.slug as string)).body as PublicReviewList)
        .summary;
      const [agg] = await handle.db
        .select({
          avg: sql<string>`round(avg(${reviews.overallRating})::numeric, 1)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(reviews)
        .where(and(eq(reviews.vehicleId, vehicle1.id), eq(reviews.status, 'published')));
      expect(summary).toEqual({ average: agg?.avg, count: agg?.count });
    });

    it('documents the Phase 8 routes in OpenAPI and keeps notification links application-relative', async () => {
      const doc = (await api().get('/api/docs-json').expect(200)).body as {
        paths: Record<string, unknown>;
      };
      const paths = Object.keys(doc.paths);
      for (const expected of [
        '/api/v1/bookings/{id}/review',
        '/api/v1/vehicles/{idOrSlug}/reviews',
        '/api/v1/providers/me/reviews',
        '/api/v1/providers/me/reviews/{id}/reply',
        '/api/v1/providers/me/metrics',
        '/api/v1/admin/reviews',
        '/api/v1/admin/reviews/{id}/hide',
        '/api/v1/admin/reviews/{id}/unhide',
        '/api/v1/notifications',
        '/api/v1/notifications/unread-count',
        '/api/v1/notifications/{id}/read',
        '/api/v1/notifications/read-all',
        '/api/v1/reference/exchange-rates',
      ]) {
        expect(paths, expected).toContain(expected);
      }
      for (const token of [customerA.body.accessToken, provider.body.accessToken]) {
        for (const n of await feedOf(token)) {
          expect(n.linkPath === null || isSafeNotificationLink(n.linkPath), n.linkPath ?? '').toBe(
            true,
          );
        }
      }
    });
  },
);
