import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminBookingSchema,
  BookingContactSchema,
  BookingListSchema,
  BookingQuoteSchema,
  BookingSchema,
  type Booking,
  type BookingQuote,
  type Vehicle,
} from '@vrp/contracts';
import {
  auditEvents,
  bookingEvents,
  bookings,
  runMigrations,
  vehicleHolds,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service';
import { BookingQuoteService } from '../src/modules/bookings/booking-quote.service';
import {
  cleanupUsers,
  emailFactory,
  findEmail,
  takeAllEmails,
  takeEmailFor,
} from './utils/auth-helpers';
import {
  TEST_DRIVER,
  adminBookingConfirm,
  createBooking,
  getBooking,
  getProviderBooking,
  providerBookingAction,
  quoteFor,
  requestBooking,
  windowAllocator,
} from './utils/booking-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
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
  blockRequest,
  colomboMidnight,
  newLocation,
  patchVehicle,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping booking e2e tests');

const SCOPE = 'bkng';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PLATE = 'WP KA-9001';

describe.skipIf(!url)('bookings (lean lifecycle)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let otherProvider: ProviderSession;
  let customerA: ApplicantSession;
  let customerB: ApplicantSession;
  let vehicle: Vehicle;
  let providerPhone: string;
  const nextWindow = windowAllocator(colomboMidnight);

  const holdsOf = async (bookingId: string) =>
    handle.db
      .select()
      .from(vehicleHolds)
      .where(and(eq(vehicleHolds.bookingId, bookingId), eq(vehicleHolds.kind, 'booking')));

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({
      DATABASE_URL: url as string,
      BOOKING_QUOTE_SECRET: 'e2e-quote-secret-with-more-than-32-characters',
    });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Sunil Rentals Mirissa');
    otherProvider = await approvedProvider(app, nextEmail(), refs, admin, 'Kamal Cars Weligama');
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicle = await approvedVehicle(
      app,
      provider.body.accessToken,
      admin.body.accessToken,
      locationId,
      {
        registrationNumber: PLATE,
      },
    );
    customerA = await newVerifiedUser(app, nextEmail());
    customerB = await newVerifiedUser(app, nextEmail());
    const profile = await request(app.getHttpServer())
      .get('/api/v1/providers/me')
      .set(auth(provider.body.accessToken))
      .expect(200);
    providerPhone = profile.body.phone as string;
    // Drain onboarding e-mails (and leftovers from other suites) so later assertions only see booking mail.
    await takeAllEmails(app);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('quotes the price, signs a token and explains why a window is not bookable', async () => {
    const w = nextWindow(3);
    const quote = (await quoteFor(app, vehicle.slug as string, w.startsAt, w.endsAt))
      .body as BookingQuote;
    expect(BookingQuoteSchema.safeParse(quote).success).toBe(true);
    expect(quote).toMatchObject({
      vehicleId: vehicle.id,
      available: true,
      bookable: true,
      reasons: [],
      price: { subtotal: '22500.00', securityDeposit: '25000.00', rentalDays: 3, basis: 'daily' },
    });
    expect(quote.quoteToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(quote.expiresAt).not.toBeNull();

    // The same window by id works too; a block makes it unavailable without a token.
    await blockRequest(app, provider.body.accessToken, vehicle.id, {
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      reason: 'maintenance',
    });
    const blocked = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    expect(blocked).toMatchObject({
      available: false,
      bookable: false,
      quoteToken: null,
      expiresAt: null,
    });
    expect(blocked.reasons).toContain('date_conflict');

    // Lead time and rental-length rules.
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    const soonEnd = new Date(Date.now() + 25 * 60 * 60_000).toISOString();
    const tooSoon = (await quoteFor(app, vehicle.id, soon, soonEnd)).body as BookingQuote;
    expect(tooSoon.reasons).toContain('too_soon');
    const long = nextWindow(31);
    const tooLong = (await quoteFor(app, vehicle.id, long.startsAt, long.endsAt))
      .body as BookingQuote;
    expect(tooLong.reasons).toContain('outside_max_days');
    await quoteFor(app, vehicle.id, w.endsAt, w.startsAt, 400);
    await quoteFor(app, 'no-such-vehicle', w.startsAt, w.endsAt, 404);
  });

  it('creates a request that does not reserve the vehicle and notifies both parties', async () => {
    const w = nextWindow(3);
    const booking = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
      {
        customerNote: 'Arriving by train at 08:30',
      },
    );
    expect(BookingSchema.safeParse(booking).success).toBe(true);
    expect(booking).toMatchObject({
      status: 'requested',
      version: 1,
      viewer: 'customer',
      rentalDays: 3,
      price: { subtotal: '22500.00', currency: 'LKR' },
      driver: { fullName: TEST_DRIVER.fullName, licenceCountry: 'LK' },
      customerNote: 'Arriving by train at 08:30',
      contact: { available: false, revealStage: 'confirmed' },
      allowedActions: ['cancel'],
      confirmBy: null,
    });
    expect(booking.reference).toMatch(/^SLR-[0-9BCDFGHJKMNPQRSTVWXYZ]{6}$/);
    expect(Date.parse(booking.respondBy)).toBeLessThanOrEqual(Date.parse(booking.startsAt));
    expect(booking.vehicle.registrationNumber).toBeNull();
    expect(booking.pickup.address).toBeNull();
    expect(booking.events.map((e) => e.action)).toEqual(['booking.requested']);

    // No hold: the window is still bookable by anyone.
    expect(await holdsOf(booking.id)).toHaveLength(0);
    const again = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    expect(again.bookable).toBe(true);

    const mails = await takeAllEmails(app);
    const toProvider = findEmail(mails, provider.email, 'New booking request');
    expect(toProvider?.text).toContain(booking.reference);
    expect(toProvider?.text).toContain('Arriving by train');
    expect(toProvider?.text).toContain('Nimal'); // first name only
    const toCustomer = findEmail(mails, customerA.email, 'We sent your request');
    expect(toCustomer?.text).toContain(booking.reference);
    expect(toCustomer?.text).toMatch(/not reserved until/);
  });

  it('rejects client prices, bad dates, invalid or stale quotes, own vehicles and missing idempotency keys', async () => {
    const w = nextWindow(2);
    const quote = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    const valid = {
      vehicleId: vehicle.id,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      quoteToken: quote.quoteToken as string,
      driver: TEST_DRIVER,
    };

    const noKey = await createBooking(app, customerA.body.accessToken, valid, undefined, 400);
    expect(noKey.body.error.details[0]).toMatchObject({ field: 'Idempotency-Key' });
    await createBooking(app, customerA.body.accessToken, valid, 'short', 400);

    const priced = await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, price: { subtotal: '1.00' } },
      randomUUID(),
      400,
    );
    expect(priced.body.error.code).toBe('VALIDATION_ERROR');
    await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, driver: { ...TEST_DRIVER, licenceExpiresOn: '2020-01-01' } },
      randomUUID(),
      400,
    );
    await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, endsAt: valid.startsAt },
      randomUUID(),
      400,
    );

    const forged = await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, quoteToken: 'abcdefghijklmnopqrst.uvwxyz0123456789' },
      randomUUID(),
      400,
    );
    expect(forged.body.error.details[0]).toMatchObject({ field: 'quoteToken' });

    const quotes = app.get(BookingQuoteService);
    const expired = quotes.issue({
      vehicleId: vehicle.id,
      startsAt: new Date(w.startsAt),
      endsAt: new Date(w.endsAt),
      price: quote.price,
      fingerprint: 'x',
      now: new Date(Date.now() - 60 * 60_000),
    });
    const expiredRes = await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, quoteToken: expired.token },
      randomUUID(),
      409,
    );
    expect(expiredRes.body.error.code).toBe('QUOTE_EXPIRED');

    const other = nextWindow(2);
    const mismatch = await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, startsAt: other.startsAt, endsAt: other.endsAt },
      randomUUID(),
      409,
    );
    expect(mismatch.body.error.code).toBe('QUOTE_CHANGED');

    // The provider changes the price after the quote was issued.
    await patchVehicle(app, provider.body.accessToken, vehicle.id, { dailyRate: '8000' });
    const changed = await createBooking(app, customerA.body.accessToken, valid, randomUUID(), 409);
    expect(changed.body.error.code).toBe('QUOTE_CHANGED');
    await patchVehicle(app, provider.body.accessToken, vehicle.id, { dailyRate: '7500' });

    const own = await createBooking(
      app,
      provider.body.accessToken,
      {
        ...valid,
        quoteToken: (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body.quoteToken,
      },
      randomUUID(),
      403,
    );
    expect(own.body.error.code).toBe('FORBIDDEN');

    const ghostId = randomUUID();
    const ghost = quotes.issue({
      vehicleId: ghostId,
      startsAt: new Date(w.startsAt),
      endsAt: new Date(w.endsAt),
      price: quote.price,
      fingerprint: 'x',
    });
    await createBooking(
      app,
      customerA.body.accessToken,
      { ...valid, vehicleId: ghostId, quoteToken: ghost.token },
      randomUUID(),
      404,
    );
  });

  it('is idempotent per customer, including under concurrency', async () => {
    const w = nextWindow(2);
    const quote = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    const body = {
      vehicleId: vehicle.id,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      quoteToken: quote.quoteToken as string,
      driver: TEST_DRIVER,
      customerNote: 'first',
    };
    const key = randomUUID();
    const first = await createBooking(app, customerA.body.accessToken, body, key, 201);
    const replay = await createBooking(app, customerA.body.accessToken, body, key, 200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    // A refreshed quote for the same request still replays (the token is not part of the fingerprint).
    const fresh = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    const replay2 = await createBooking(
      app,
      customerA.body.accessToken,
      { ...body, quoteToken: fresh.quoteToken as string },
      key,
      200,
    );
    expect(replay2.body.id).toBe(first.body.id);

    const conflict = await createBooking(
      app,
      customerA.body.accessToken,
      { ...body, customerNote: 'second' },
      key,
      409,
    );
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // Keys are scoped per customer; another customer may request the same period.
    const byB = await createBooking(app, customerB.body.accessToken, body, key, 201);
    expect(byB.body.id).not.toBe(first.body.id);

    // Three identical requests at once create exactly one booking.
    const w2 = nextWindow(2);
    const q2 = (await quoteFor(app, vehicle.id, w2.startsAt, w2.endsAt)).body as BookingQuote;
    const body2 = {
      ...body,
      startsAt: w2.startsAt,
      endsAt: w2.endsAt,
      quoteToken: q2.quoteToken as string,
    };
    const key2 = randomUUID();
    const burst = await Promise.all(
      [0, 1, 2].map(() => createBooking(app, customerA.body.accessToken, body2, key2)),
    );
    expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(burst.map((r) => r.body.id as string)).size).toBe(1);
    const rows = await handle.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.customerUserId, customerA.userId),
          eq(bookings.startsAt, new Date(w2.startsAt)),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  describe('accept → confirm → pickup → return', () => {
    let a: Booking;
    let b: Booking;
    let w: { startsAt: string; endsAt: string };

    it('lets two customers request the same period and reserves the vehicle only on acceptance', async () => {
      w = nextWindow(3);
      a = await requestBooking(app, customerA.body.accessToken, vehicle.id, w.startsAt, w.endsAt);
      b = await requestBooking(app, customerB.body.accessToken, vehicle.id, w.startsAt, w.endsAt);
      expect(b.status).toBe('requested');

      const inbox = await request(app.getHttpServer())
        .get('/api/v1/providers/me/bookings')
        .query({ status: 'requested' })
        .set(auth(provider.body.accessToken))
        .expect(200);
      expect(BookingListSchema.safeParse(inbox.body).success).toBe(true);
      const ids = (inbox.body.data as Booking[]).map((x) => x.id);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
      const inboxA = (inbox.body.data as Booking[]).find((x) => x.id === a.id) as Booking;
      expect(inboxA.viewer).toBe('provider');
      expect(inboxA.customer.name).toBe('Nimal');
      expect(inboxA.allowedActions).toEqual(['accept', 'decline']);

      const accepted = await providerBookingAction(
        app,
        provider.body.accessToken,
        a.id,
        'accept',
        { version: 1, providerNote: 'Meet at the blue gate' },
        200,
      );
      expect(accepted.body).toMatchObject({
        status: 'accepted',
        version: 2,
        providerNote: 'Meet at the blue gate',
        allowedActions: ['cancel'],
      });
      expect(accepted.body.confirmBy).not.toBeNull();
      expect(Date.parse(accepted.body.acceptedAt)).toBeGreaterThan(0);
      const holds = await holdsOf(a.id);
      expect(holds).toHaveLength(1);
      expect(holds[0]).toMatchObject({ vehicleId: vehicle.id, kind: 'booking' });
      expect(holds[0]?.startsAt.toISOString()).toBe(new Date(w.startsAt).toISOString());
      expect(holds[0]?.endsAt.toISOString()).toBe(new Date(w.endsAt).toISOString());

      // The overlapping request was auto-declined, told why, and can no longer be accepted.
      const bNow = (await getBooking(app, customerB.body.accessToken, b.id)).body as Booking;
      expect(bNow).toMatchObject({
        status: 'declined',
        declineReason: 'vehicle_no_longer_available',
        version: 2,
      });
      const declineEvent = bNow.events.find((e) => e.action === 'booking.declined');
      expect(declineEvent).toMatchObject({ actorType: 'system', metadata: { automatic: true } });
      const stale = await providerBookingAction(app, provider.body.accessToken, b.id, 'accept', {
        version: 1,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_VERSION');
      const invalid = await providerBookingAction(app, provider.body.accessToken, b.id, 'accept', {
        version: 2,
      });
      expect(invalid.status).toBe(409);
      expect(invalid.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const unavailable = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt))
        .body as BookingQuote;
      expect(unavailable.reasons).toContain('date_conflict');

      const mails = await takeAllEmails(app);
      expect(findEmail(mails, customerA.email, 'accepted your request')?.text).toContain(
        'Meet at the blue gate',
      );
      expect(findEmail(mails, customerB.email, 'was not accepted')?.text).toMatch(
        /closed automatically/,
      );
    });

    it('hides exact details and contact until confirmation and scopes access to participants', async () => {
      const mine = (await getBooking(app, customerA.body.accessToken, a.id)).body as Booking;
      expect(mine.vehicle.registrationNumber).toBeNull();
      expect(mine.pickup.address).toBeNull();
      expect(mine.pickup.point).toBeNull();
      expect(mine.customer.name).toBe('Nimal Perera');
      expect(mine.pickup.placeName).toBe('Mirissa');
      const raw = JSON.stringify(mine);
      expect(raw).not.toContain(providerPhone);
      expect(raw).not.toContain(provider.email);
      expect(raw).not.toContain(PLATE);

      await getBooking(app, customerB.body.accessToken, a.id, 404);
      await getProviderBooking(app, otherProvider.body.accessToken, a.id, 404);
      await providerBookingAction(
        app,
        otherProvider.body.accessToken,
        a.id,
        'accept',
        { version: 2 },
        404,
      );
      await providerBookingAction(
        app,
        customerA.body.accessToken,
        a.id,
        'accept',
        { version: 2 },
        403,
      );
      const asProvider = await adminBookingConfirm(
        app,
        provider.body.accessToken,
        a.id,
        { version: 2 },
        403,
      );
      expect(asProvider.body.error.code).toBe('FORBIDDEN');
      await adminBookingConfirm(app, customerA.body.accessToken, a.id, { version: 2 }, 403);

      for (const token of [customerA.body.accessToken, provider.body.accessToken]) {
        const contact = await request(app.getHttpServer())
          .get(`/api/v1/bookings/${a.id}/contact`)
          .set(auth(token))
          .expect(403);
        expect(contact.body.error.code).toBe('CONTACT_NOT_AVAILABLE_YET');
      }
      await request(app.getHttpServer())
        .get(`/api/v1/bookings/${a.id}/contact`)
        .set(auth(customerB.body.accessToken))
        .expect(404);

      const theirs = (await getProviderBooking(app, provider.body.accessToken, a.id))
        .body as Booking;
      expect(theirs.customer.name).toBe('Nimal');
      expect(theirs.driver?.fullName).toBe(TEST_DRIVER.fullName);
      expect(theirs.vehicle.registrationNumber).toBe(PLATE);
      expect(JSON.stringify(theirs)).not.toContain(customerA.email);
    });

    it('is confirmed by the admin testing bridge; both sides then see exact details and contact', async () => {
      const confirmed = await adminBookingConfirm(app, admin.body.accessToken, a.id, {
        version: 2,
        note: 'Local test run',
      });
      expect(confirmed.status).toBe(200);
      expect(AdminBookingSchema.safeParse(confirmed.body).success).toBe(true);
      expect(confirmed.body).toMatchObject({
        status: 'confirmed',
        version: 3,
        viewer: 'admin',
        confirmationSource: 'admin_testing',
        customerEmail: customerA.email,
        providerEmail: provider.email,
        testingConfirmationEnabled: true,
      });
      expect(confirmed.body.hold).toMatchObject({ kind: 'booking', vehicleId: vehicle.id });
      const audit = await handle.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.targetType, 'booking'), eq(auditEvents.targetId, a.id)));
      expect(audit.map((e) => e.action)).toEqual(['booking.confirmed_for_testing']);
      expect(audit[0]).toMatchObject({
        actorType: 'admin',
        actorUserId: admin.userId,
        reason: 'Local test run',
      });

      const mails = await takeAllEmails(app);
      const customerMail = findEmail(mails, customerA.email, 'confirmed');
      expect(customerMail?.text).toContain('12 Beach Road');
      expect(customerMail?.text).toContain('Blue gate');
      expect(findEmail(mails, provider.email, 'confirmed')?.text).toContain('Nimal Perera');

      const mine = (await getBooking(app, customerA.body.accessToken, a.id)).body as Booking;
      expect(mine.vehicle.registrationNumber).toBe(PLATE);
      expect(mine.pickup.address).toBe('12 Beach Road, Mirissa 81740');
      expect(mine.pickup.instructions).toBe('Blue gate opposite the fish market.');
      expect(mine.pickup.point).toEqual({ lat: 5.9485, lng: 80.4718 });
      expect(mine.contact.available).toBe(true);
      expect(mine.allowedActions).toEqual(['cancel', 'reveal_contact']);

      const forCustomer = await request(app.getHttpServer())
        .get(`/api/v1/bookings/${a.id}/contact`)
        .set(auth(customerA.body.accessToken))
        .expect(200);
      expect(BookingContactSchema.safeParse(forCustomer.body).success).toBe(true);
      expect(forCustomer.body).toMatchObject({
        party: 'provider',
        phone: providerPhone,
        email: provider.email,
      });
      expect(forCustomer.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
      const forProvider = await request(app.getHttpServer())
        .get(`/api/v1/bookings/${a.id}/contact`)
        .set(auth(provider.body.accessToken))
        .expect(200);
      expect(forProvider.body).toMatchObject({
        party: 'customer',
        name: 'Nimal Perera',
        email: customerA.email,
      });

      const theirs = (await getProviderBooking(app, provider.body.accessToken, a.id))
        .body as Booking;
      expect(theirs.customer.name).toBe('Nimal Perera');
      expect(theirs.events.filter((e) => e.action === 'booking.contact_revealed')).toHaveLength(2);

      const again = await adminBookingConfirm(
        app,
        admin.body.accessToken,
        a.id,
        { version: 3 },
        409,
      );
      expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
      const stale = await adminBookingConfirm(
        app,
        admin.body.accessToken,
        a.id,
        { version: 2 },
        409,
      );
      expect(stale.body.error.code).toBe('STALE_VERSION');
    });

    it('records pickup and return; the completed booking keeps its hold as history', async () => {
      const early = await providerBookingAction(app, provider.body.accessToken, a.id, 'return', {
        version: 3,
      });
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const active = await providerBookingAction(
        app,
        provider.body.accessToken,
        a.id,
        'pickup',
        {
          version: 3,
          odometerKm: 45210,
          fuelLevel: 6,
          note: 'Full tank, small scratch on rear bumper',
        },
        200,
      );
      expect(active.body).toMatchObject({
        status: 'active',
        version: 4,
        handover: { pickupOdometerKm: 45210, pickupFuelLevel: 6 },
        allowedActions: ['return', 'reveal_contact'],
      });
      expect((await takeEmailFor(app, customerA.email, 'Pickup recorded'))?.text).toContain(
        '45210 km',
      );

      const completed = await providerBookingAction(
        app,
        provider.body.accessToken,
        a.id,
        'return',
        { version: 4, odometerKm: 45810, fuelLevel: 5 },
        200,
      );
      expect(completed.body).toMatchObject({
        status: 'completed',
        version: 5,
        handover: { returnOdometerKm: 45810, returnFuelLevel: 5 },
      });
      expect((await takeEmailFor(app, customerA.email, 'completed'))?.text).toContain('45810 km');
      expect(await holdsOf(a.id)).toHaveLength(1);
      const still = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
      expect(still.available).toBe(false);

      const timeline = (await getBooking(app, customerA.body.accessToken, a.id)).body as Booking;
      expect(timeline.events.map((e) => e.action)).toEqual([
        'booking.requested',
        'booking.accepted',
        'booking.confirmed',
        'booking.contact_revealed',
        'booking.contact_revealed',
        'booking.picked_up',
        'booking.completed',
      ]);
      const cancelDone = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${a.id}/cancel`)
        .set(auth(customerA.body.accessToken))
        .send({ version: 5 })
        .expect(409);
      expect(cancelDone.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  it('declines with a controlled reason and a bounded note', async () => {
    const w = nextWindow(2);
    const b = await requestBooking(
      app,
      customerB.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'decline',
      { version: 1, reason: 'other' },
      400,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'decline',
      { version: 1, reason: 'not_a_reason' },
      400,
    );
    const declined = await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'decline',
      { version: 1, reason: 'schedule_conflict', note: 'Vehicle is at the garage that week' },
      200,
    );
    expect(declined.body).toMatchObject({
      status: 'declined',
      declineReason: 'schedule_conflict',
      declineNote: 'Vehicle is at the garage that week',
      allowedActions: [],
    });
    const mail = await takeEmailFor(app, customerB.email, 'was not accepted');
    expect(mail?.text).toContain('schedule conflict');
    expect(mail?.text).toContain('Vehicle is at the garage that week');
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'decline',
      { version: 2, reason: 'other', note: 'again' },
      409,
    );
    expect(await holdsOf(b.id)).toHaveLength(0);
  });

  it('releases the hold on cancellation by either side', async () => {
    const w = nextWindow(2);
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      a.id,
      'accept',
      { version: 1 },
      200,
    );
    expect(await holdsOf(a.id)).toHaveLength(1);
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${a.id}/cancel`)
      .set(auth(customerA.body.accessToken))
      .send({ version: 2, note: 'Plans changed' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled_by_customer',
      version: 3,
      cancellationNote: 'Plans changed',
    });
    expect(await holdsOf(a.id)).toHaveLength(0);
    expect((await takeEmailFor(app, provider.email, 'was cancelled'))?.text).toContain(
      'Plans changed',
    );
    const free = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    expect(free.bookable).toBe(true);

    // Provider cancels a confirmed booking.
    const a2 = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      a2.id,
      'accept',
      { version: 1 },
      200,
    );
    await adminBookingConfirm(app, admin.body.accessToken, a2.id, { version: 2 }, 200);
    await takeEmailFor(app, customerA.email, 'confirmed');
    const byProvider = await providerBookingAction(
      app,
      provider.body.accessToken,
      a2.id,
      'cancel',
      { version: 3, note: 'Engine trouble' },
      200,
    );
    expect(byProvider.body.status).toBe('cancelled_by_provider');
    expect(await holdsOf(a2.id)).toHaveLength(0);
    expect((await takeEmailFor(app, customerA.email, 'was cancelled'))?.text).toContain(
      'Engine trouble',
    );

    // A customer withdraws a plain request; a provider cannot "cancel" one (decline instead).
    const w3 = nextWindow(2);
    const r = await requestBooking(
      app,
      customerB.body.accessToken,
      vehicle.id,
      w3.startsAt,
      w3.endsAt,
    );
    const providerCancel = await providerBookingAction(
      app,
      provider.body.accessToken,
      r.id,
      'cancel',
      { version: 1 },
    );
    expect(providerCancel.status).toBe(409);
    const withdrawn = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${r.id}/cancel`)
      .set(auth(customerB.body.accessToken))
      .send({ version: 1 })
      .expect(200);
    expect(withdrawn.body.status).toBe('cancelled_by_customer');
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${r.id}/cancel`)
      .set(auth(customerA.body.accessToken))
      .send({ version: 2 })
      .expect(404);
  });

  it('expires overdue requests and unconfirmed acceptances with a controlled clock', async () => {
    const expiry = app.get(BookingExpiryService);
    const w = nextWindow(2);
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    const notYet = await expiry.expireDue(new Date());
    expect(notYet.requestsExpired).toBe(0);
    expect((await getBooking(app, customerA.body.accessToken, a.id)).body.status).toBe('requested');

    const due = new Date(Date.parse(a.respondBy) + 1000);
    const swept = await expiry.expireDue(due);
    expect(swept.requestsExpired).toBeGreaterThanOrEqual(1);
    const expired = (await getBooking(app, customerA.body.accessToken, a.id)).body as Booking;
    expect(expired).toMatchObject({ status: 'expired', version: 2, allowedActions: [] });
    expect(expired.expiredAt).not.toBeNull();
    expect(expired.events.at(-1)).toMatchObject({
      action: 'booking.expired',
      actorType: 'system',
      metadata: { stage: 'request' },
    });
    expect((await takeEmailFor(app, customerA.email, `${a.reference} expired`))?.text).toMatch(
      /did not respond in time/,
    );
    expect((await expiry.expireDue(due)).requestsExpired).toBe(0);

    // Accepted but never confirmed: the hold is released and both parties are told.
    const w2 = nextWindow(2);
    const b = await requestBooking(
      app,
      customerB.body.accessToken,
      vehicle.id,
      w2.startsAt,
      w2.endsAt,
    );
    const accepted = await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'accept',
      { version: 1 },
      200,
    );
    await takeEmailFor(app, customerB.email, 'accepted');
    expect(await holdsOf(b.id)).toHaveLength(1);
    const confirmBy = new Date(Date.parse(accepted.body.confirmBy as string) + 1000);
    const swept2 = await expiry.expireDue(confirmBy);
    expect(swept2.acceptancesExpired).toBeGreaterThanOrEqual(1);
    const bExpired = (await getBooking(app, customerB.body.accessToken, b.id)).body as Booking;
    expect(bExpired).toMatchObject({ status: 'expired', version: 3 });
    expect(bExpired.events.at(-1)).toMatchObject({
      metadata: { stage: 'acceptance', holdReleased: true },
    });
    expect(await holdsOf(b.id)).toHaveLength(0);
    const expiryMails = await takeAllEmails(app);
    expect(findEmail(expiryMails, customerB.email, `${b.reference} expired before`)).toBeDefined();
    expect(findEmail(expiryMails, provider.email, `${b.reference} expired before`)).toBeDefined();

    // A provider acting on an overdue request finds it expired (lazy expiry, 410).
    const w3 = nextWindow(2);
    const c = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w3.startsAt,
      w3.endsAt,
    );
    await handle.db
      .update(bookings)
      .set({ respondBy: new Date(Date.now() - 60_000) })
      .where(eq(bookings.id, c.id));
    const late = await providerBookingAction(app, provider.body.accessToken, c.id, 'accept', {
      version: 1,
    });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('REQUEST_EXPIRED');
    expect((await getBooking(app, customerA.body.accessToken, c.id)).body.status).toBe('expired');
    expect(await holdsOf(c.id)).toHaveLength(0);
  });

  it('allows a no-show only after the grace period and releases the hold', async () => {
    const w = nextWindow(2);
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      a.id,
      'accept',
      { version: 1 },
      200,
    );
    await adminBookingConfirm(app, admin.body.accessToken, a.id, { version: 2 }, 200);
    const tooEarly = await providerBookingAction(app, provider.body.accessToken, a.id, 'no-show', {
      version: 3,
      note: 'Called three times, no answer',
    });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('GRACE_PERIOD_NOT_ELAPSED');
    await providerBookingAction(
      app,
      provider.body.accessToken,
      a.id,
      'no-show',
      { version: 3, note: 'x' },
      400,
    );

    // Move the pickup time into the past (test-only) so the grace period has elapsed.
    await handle.db
      .update(bookings)
      .set({
        startsAt: new Date(Date.now() - 4 * 3_600_000),
        endsAt: new Date(Date.now() + 20 * 3_600_000),
      })
      .where(eq(bookings.id, a.id));
    const marked = await providerBookingAction(
      app,
      provider.body.accessToken,
      a.id,
      'no-show',
      { version: 3, note: 'Called three times, no answer' },
      200,
    );
    expect(marked.body).toMatchObject({
      status: 'no_show',
      version: 4,
      noShowNote: 'Called three times, no answer',
    });
    expect(await holdsOf(a.id)).toHaveLength(0);
    expect(await takeEmailFor(app, customerA.email, 'no-show')).toBeDefined();
  });

  it('lists bookings per role with filters, and exposes the admin view and OpenAPI paths', async () => {
    const mine = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .query({ scope: 'past', limit: 50 })
      .set(auth(customerA.body.accessToken))
      .expect(200);
    expect(BookingListSchema.safeParse(mine.body).success).toBe(true);
    expect((mine.body.data as Booking[]).length).toBeGreaterThan(0);
    for (const row of mine.body.data as Booking[]) {
      expect([
        'completed',
        'declined',
        'expired',
        'cancelled_by_customer',
        'cancelled_by_provider',
        'no_show',
      ]).toContain(row.status);
      expect(row.viewer).toBe('customer');
    }
    const open = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .query({ scope: 'open' })
      .set(auth(customerB.body.accessToken))
      .expect(200);
    for (const row of open.body.data as Booking[]) {
      expect(['requested', 'accepted', 'confirmed', 'active']).toContain(row.status);
    }

    const theirs = await request(app.getHttpServer())
      .get('/api/v1/providers/me/bookings')
      .query({ vehicleId: vehicle.id, status: 'completed' })
      .set(auth(provider.body.accessToken))
      .expect(200);
    expect((theirs.body.data as Booking[]).every((r) => r.status === 'completed')).toBe(true);
    expect((theirs.body.data as Booking[]).length).toBeGreaterThan(0);
    const none = await request(app.getHttpServer())
      .get('/api/v1/providers/me/bookings')
      .set(auth(otherProvider.body.accessToken))
      .expect(200);
    expect(none.body.data).toEqual([]);

    const sample = (theirs.body.data as Booking[])[0] as Booking;
    const adminList = await request(app.getHttpServer())
      .get('/api/v1/admin/bookings')
      .query({ reference: sample.reference.toLowerCase() })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect((adminList.body.data as Booking[]).map((r) => r.id)).toEqual([sample.id]);
    await request(app.getHttpServer())
      .get('/api/v1/admin/bookings')
      .set(auth(customerA.body.accessToken))
      .expect(403);
    const adminDetail = await request(app.getHttpServer())
      .get(`/api/v1/admin/bookings/${sample.id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminBookingSchema.safeParse(adminDetail.body).success).toBe(true);

    // The timeline is append-only at the database level (Drizzle wraps the PostgreSQL error as `cause`).
    await expect(
      handle.db
        .update(bookingEvents)
        .set({ action: 'tampered' })
        .where(eq(bookingEvents.bookingId, sample.id)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }),
    });

    const openapi = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const paths = Object.keys(openapi.body.paths as Record<string, unknown>);
    for (const path of [
      '/api/v1/vehicles/{idOrSlug}/quote',
      '/api/v1/bookings',
      '/api/v1/bookings/{id}',
      '/api/v1/bookings/{id}/cancel',
      '/api/v1/bookings/{id}/contact',
      '/api/v1/providers/me/bookings',
      '/api/v1/providers/me/bookings/{id}/accept',
      '/api/v1/providers/me/bookings/{id}/decline',
      '/api/v1/providers/me/bookings/{id}/pickup',
      '/api/v1/providers/me/bookings/{id}/return',
      '/api/v1/providers/me/bookings/{id}/no-show',
      '/api/v1/admin/bookings/{id}/confirm-for-testing',
    ]) {
      expect(paths, path).toContain(path);
    }
  });
});
