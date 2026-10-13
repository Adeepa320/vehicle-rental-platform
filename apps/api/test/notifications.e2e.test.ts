import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  isSafeNotificationLink,
  type Booking,
  type Notification,
  type NotificationList,
} from '@vrp/contracts';
import { bookings, notifications, runMigrations, type DatabaseHandle } from '@vrp/database';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service';
import { NotificationsService } from '../src/modules/notifications/inapp/notifications.service';
import { RemindersService } from '../src/modules/notifications/reminders/reminders.service';
import { cleanupUsers, emailFactory, findEmail, takeAllEmails } from './utils/auth-helpers';
import { providerBookingAction, requestBooking, windowAllocator } from './utils/booking-helpers';
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
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping notifications e2e tests');

const SCOPE = 'ntf';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plus = (date: Date | string, ms: number) => new Date(new Date(date).getTime() + ms);

describe.skipIf(!url)('in-app notifications and reminders', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let customerA: ApplicantSession;
  let customerB: ApplicantSession;
  let vehicleId: string;
  let reminders: RemindersService;
  let expiry: BookingExpiryService;
  const nextWindow = windowAllocator(colomboMidnight, 10);

  const api = () => request(app.getHttpServer());
  const list = async (token: string, query = '?limit=50'): Promise<NotificationList> =>
    (await api().get(`/api/v1/notifications${query}`).set(auth(token)).expect(200))
      .body as NotificationList;
  const feedFor = async (token: string, bookingId: string): Promise<Notification[]> =>
    (await list(token)).data.filter((n) => n.linkPath?.includes(bookingId));
  const unread = async (token: string): Promise<number> =>
    (
      (await api().get('/api/v1/notifications/unread-count').set(auth(token)).expect(200)).body as {
        unread: number;
      }
    ).unread;
  const accepted = async (customer: ApplicantSession, length = 3): Promise<Booking> => {
    const w = nextWindow(length);
    const b = await requestBooking(app, customer.body.accessToken, vehicleId, w.startsAt, w.endsAt);
    const res = await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'accept',
      { version: 1 },
      200,
    );
    return res.body as Booking;
  };
  const confirmed = async (customer: ApplicantSession, length = 3): Promise<Booking> => {
    const b = await accepted(customer, length);
    return (await payAdvance(app, customer.body.accessToken, b.id)).booking;
  };
  const completed = async (customer: ApplicantSession, length = 2): Promise<Booking> => {
    const b = await confirmed(customer, length);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'pickup',
      { version: 3 },
      200,
    );
    return (
      await providerBookingAction(
        app,
        provider.body.accessToken,
        b.id,
        'return',
        { version: 4 },
        200,
      )
    ).body as Booking;
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    reminders = app.get(RemindersService);
    expiry = app.get(BookingExpiryService);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Notify Rentals Mirissa');
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicleId = (
      await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
        registrationNumber: 'WP NT-8001',
      })
    ).id;
    customerA = await newVerifiedUser(app, nextEmail());
    customerB = await newVerifiedUser(app, nextEmail());
    await takeAllEmails(app);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('creates scoped lifecycle notifications with safe links and no payment or contact data', async () => {
    const w = nextWindow(3);
    const b = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicleId,
      w.startsAt,
      w.endsAt,
    );
    expect(await feedFor(provider.body.accessToken, b.id)).toMatchObject([
      { type: 'booking.requested', linkPath: `/provider/bookings/${b.id}`, readAt: null },
    ]);
    expect(await feedFor(customerA.body.accessToken, b.id)).toMatchObject([
      { type: 'booking.requested', linkPath: `/bookings/${b.id}` },
    ]);
    expect(await feedFor(customerB.body.accessToken, b.id)).toEqual([]);

    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'accept',
      { version: 1 },
      200,
    );
    const afterAccept = await feedFor(customerA.body.accessToken, b.id);
    expect(afterAccept[0]).toMatchObject({ type: 'booking.accepted' });
    expect(afterAccept[0]?.body).toContain('Pay the advance of LKR 2,250');

    const paid = await payAdvance(app, customerA.body.accessToken, b.id);
    expect((await feedFor(customerA.body.accessToken, b.id))[0]).toMatchObject({
      type: 'booking.confirmed',
    });
    expect((await feedFor(provider.body.accessToken, b.id))[0]).toMatchObject({
      type: 'booking.confirmed',
      linkPath: `/provider/bookings/${b.id}`,
    });

    const rows = await handle.db
      .select()
      .from(notifications)
      .where(inArray(notifications.userId, [customerA.userId, provider.userId]));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(Object.keys(row.metadata ?? {})).toEqual(['bookingId']);
      expect(row.linkPath === null || isSafeNotificationLink(row.linkPath)).toBe(true);
      expect(row.dedupeKey).toMatch(/^booking:/);
    }
    const json = JSON.stringify((await list(customerA.body.accessToken)).data);
    for (const forbidden of [
      paid.checkout.fields.order_id as string,
      paid.gatewayPaymentId,
      paid.checkout.paymentId,
      'md5sig',
      'metadata',
      'dedupeKey',
      customerA.email,
      provider.email,
      '@example.com',
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(await unread(customerA.body.accessToken)).toBe(3);
  });

  it('scopes the feed per user, paginates by keyset and marks read idempotently', async () => {
    const all = await list(customerA.body.accessToken);
    expect(all.data).toHaveLength(3);
    expect((await list(customerA.body.accessToken, '?unreadOnly=true')).data).toHaveLength(3);
    const page1 = await list(customerA.body.accessToken, '?limit=2');
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await list(
      customerA.body.accessToken,
      `?limit=2&cursor=${encodeURIComponent(page1.nextCursor as string)}`,
    );
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.data, ...page2.data].map((n) => n.id)).size).toBe(3);
    expect(
      (
        await api()
          .get('/api/v1/notifications?cursor=garbage')
          .set(auth(customerA.body.accessToken))
      ).status,
    ).toBe(400);

    const first = all.data[0] as Notification;
    const read1 = (
      await api()
        .post(`/api/v1/notifications/${first.id}/read`)
        .set(auth(customerA.body.accessToken))
        .expect(200)
    ).body as Notification;
    expect(read1.readAt).not.toBeNull();
    const read2 = (
      await api()
        .post(`/api/v1/notifications/${first.id}/read`)
        .set(auth(customerA.body.accessToken))
        .expect(200)
    ).body as Notification;
    expect(read2.readAt).toBe(read1.readAt);
    expect(await unread(customerA.body.accessToken)).toBe(2);

    await api()
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(auth(customerB.body.accessToken))
      .expect(404);
    await api()
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(auth(admin.body.accessToken))
      .expect(404);
    expect(
      (
        await api()
          .post('/api/v1/notifications/read-all')
          .set(auth(customerB.body.accessToken))
          .expect(200)
      ).body,
    ).toEqual({
      marked: 0,
    });
    expect(await unread(customerA.body.accessToken)).toBe(2);
    expect(
      (
        await api()
          .post('/api/v1/notifications/read-all')
          .set(auth(customerA.body.accessToken))
          .expect(200)
      ).body,
    ).toEqual({
      marked: 2,
    });
    expect(await unread(customerA.body.accessToken)).toBe(0);
    expect((await list(customerA.body.accessToken, '?unreadOnly=true')).data).toEqual([]);
    expect((await list(admin.body.accessToken)).data.map((n) => n.id)).not.toContain(first.id);
    await api().get('/api/v1/notifications').expect(401);
  });

  it('refuses unsafe links and payment identifiers at creation time', async () => {
    const service = app.get(NotificationsService);
    await expect(
      service.create(handle.db, {
        userId: customerA.userId,
        type: 'booking.accepted',
        title: 'x',
        body: 'y',
        linkPath: 'https://evil.example/phish',
      }),
    ).rejects.toThrow(/unsafe notification link/);
    await expect(
      service.create(handle.db, {
        userId: customerA.userId,
        type: 'booking.accepted',
        title: 'x',
        body: 'y',
        metadata: { gatewayPaymentId: 'PH-1' },
      }),
    ).rejects.toThrow(/metadata key/);
    const once = await service.create(handle.db, {
      userId: customerA.userId,
      type: 'booking.accepted',
      title: 'Deduped',
      body: 'y',
      dedupeKey: `test:${SCOPE}:${Date.now()}`,
    });
    expect(once).not.toBeNull();
    const twice = await service.create(handle.db, {
      userId: customerA.userId,
      type: 'booking.accepted',
      title: 'Deduped',
      body: 'y',
      dedupeKey: once?.dedupeKey as string,
    });
    expect(twice).toBeNull();
    await handle.db.delete(notifications).where(eq(notifications.id, once?.id as string));
  });

  it('sends the payment reminder once before the deadline and never after payment or expiry', async () => {
    const b = await accepted(customerA);
    const confirmBy = new Date(b.confirmBy as string);
    await takeAllEmails(app);

    expect(await reminders.sendDue(plus(confirmBy, -7 * HOUR))).toMatchObject({
      paymentReminders: 0,
    });
    expect(
      (await feedFor(customerA.body.accessToken, b.id)).filter(
        (n) => n.type === 'payment.reminder',
      ),
    ).toHaveLength(0);
    expect(await takeAllEmails(app)).toEqual([]);

    expect(await reminders.sendDue(plus(confirmBy, -5 * HOUR))).toMatchObject({
      paymentReminders: 1,
    });
    const mails = await takeAllEmails(app);
    expect(findEmail(mails, customerA.email, 'Reminder: pay the advance')?.text).toContain(
      'LKR 2,250',
    );
    expect(mails).toHaveLength(1);
    expect(
      (await feedFor(customerA.body.accessToken, b.id)).filter(
        (n) => n.type === 'payment.reminder',
      ),
    ).toHaveLength(1);

    // Retried / overlapping sweeps: no second row, no second e-mail.
    expect(await reminders.sendDue(plus(confirmBy, -4 * HOUR))).toMatchObject({
      paymentReminders: 0,
    });
    expect(await reminders.sendPaymentReminder(b.id, plus(confirmBy, -4 * HOUR))).toBe(false);
    expect(await takeAllEmails(app)).toEqual([]);
    expect(
      (await feedFor(customerA.body.accessToken, b.id)).filter(
        (n) => n.type === 'payment.reminder',
      ),
    ).toHaveLength(1);

    // Paid before the threshold: nothing.
    const paid = await accepted(customerB);
    await payAdvance(app, customerB.body.accessToken, paid.id);
    await takeAllEmails(app);
    expect(
      await reminders.sendDue(plus(new Date(paid.confirmBy as string), -5 * HOUR)),
    ).toMatchObject({ paymentReminders: 0 });
    expect(
      (await feedFor(customerB.body.accessToken, paid.id)).filter(
        (n) => n.type === 'payment.reminder',
      ),
    ).toHaveLength(0);

    // Deadline passed (expired by the sweep): nothing, and the late sweep never reminds either.
    const stale = await accepted(customerB);
    const staleBy = new Date(stale.confirmBy as string);
    await expiry.expireDue(plus(staleBy, 60_000));
    expect(await reminders.sendDue(plus(staleBy, -5 * HOUR))).toMatchObject({
      paymentReminders: 0,
    });
    expect(await reminders.sendDue(plus(staleBy, 2 * HOUR))).toMatchObject({ paymentReminders: 0 });
    expect(
      (await feedFor(customerB.body.accessToken, stale.id)).filter(
        (n) => n.type === 'payment.reminder',
      ),
    ).toHaveLength(0);
    expect(
      (await feedFor(customerB.body.accessToken, stale.id)).some(
        (n) => n.type === 'booking.expired',
      ),
    ).toBe(true);
    await takeAllEmails(app);
  });

  it('sends the pickup reminder once per confirmed booking to both parties, inside the window only', async () => {
    const b = await confirmed(customerA);
    const startsAt = new Date(b.startsAt);
    await takeAllEmails(app);

    expect(await reminders.sendDue(plus(startsAt, -25 * HOUR))).toMatchObject({
      pickupReminders: 0,
    });
    expect(await reminders.sendDue(plus(startsAt, -23 * HOUR))).toMatchObject({
      pickupReminders: 1,
    });
    const mails = await takeAllEmails(app);
    expect(findEmail(mails, customerA.email, 'Reminder: pickup')?.text).toContain('12 Beach Road');
    expect(findEmail(mails, provider.email, 'Reminder: handover')?.text).toContain('Nimal Perera');
    expect(mails).toHaveLength(2);
    expect(
      (await feedFor(customerA.body.accessToken, b.id)).filter((n) => n.type === 'pickup.reminder'),
    ).toHaveLength(1);
    expect(
      (await feedFor(provider.body.accessToken, b.id)).filter((n) => n.type === 'pickup.reminder'),
    ).toHaveLength(1);
    expect(await reminders.sendDue(plus(startsAt, -22 * HOUR))).toMatchObject({
      pickupReminders: 0,
    });
    expect(await reminders.sendPickupReminder(b.id, plus(startsAt, -22 * HOUR))).toBe(false);
    expect(await takeAllEmails(app)).toEqual([]);

    // Not for an unpaid (accepted) booking, a cancelled one, or after pickup.
    const unpaid = await accepted(customerB);
    const cancelled = await confirmed(customerB);
    await api()
      .post(`/api/v1/bookings/${cancelled.id}/cancel`)
      .set(auth(customerB.body.accessToken))
      .send({ version: cancelled.version })
      .expect(200);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'pickup',
      { version: 3 },
      200,
    );
    await takeAllEmails(app);
    for (const target of [unpaid, cancelled, b]) {
      expect(
        await reminders.sendPickupReminder(target.id, plus(new Date(target.startsAt), -23 * HOUR)),
      ).toBe(false);
    }
    expect(await takeAllEmails(app)).toEqual([]);
  });

  it('asks for a review on completion and reminds once while the window is open, never once reviewed', async () => {
    const b = await completed(customerA);
    const completedAt = new Date(b.completedAt as string);
    const feed = await feedFor(customerA.body.accessToken, b.id);
    expect(feed.find((n) => n.type === 'review.request')).toMatchObject({
      linkPath: `/bookings/${b.id}/review`,
    });
    const completedMail = findEmail(await takeAllEmails(app), customerA.email, 'completed');
    expect(completedMail?.text).toContain(`/bookings/${b.id}/review`);

    expect(await reminders.sendDue(plus(completedAt, 2 * DAY))).toMatchObject({
      reviewReminders: 0,
    });
    expect(await reminders.sendDue(plus(completedAt, 4 * DAY))).toMatchObject({
      reviewReminders: 1,
    });
    const mails = await takeAllEmails(app);
    expect(findEmail(mails, customerA.email, 'How was your rental')?.text).toContain(
      `/bookings/${b.id}/review`,
    );
    expect(mails).toHaveLength(1);
    expect(
      (await feedFor(customerA.body.accessToken, b.id)).filter((n) => n.type === 'review.reminder'),
    ).toHaveLength(1);
    expect(await reminders.sendDue(plus(completedAt, 5 * DAY))).toMatchObject({
      reviewReminders: 0,
    });
    expect(await takeAllEmails(app)).toEqual([]);

    // Reviewed: no reminder. Window closed: no reminder.
    const reviewed = await completed(customerB);
    await api()
      .post(`/api/v1/bookings/${reviewed.id}/review`)
      .set(auth(customerB.body.accessToken))
      .send({ overallRating: 5 })
      .expect(201);
    const old = await completed(customerB);
    await handle.db
      .update(bookings)
      .set({ completedAt: plus(completedAt, -20 * DAY) })
      .where(eq(bookings.id, old.id));
    await takeAllEmails(app);
    expect(await reminders.sendReviewReminder(reviewed.id, plus(completedAt, 4 * DAY))).toBe(false);
    expect(await reminders.sendReviewReminder(old.id, plus(completedAt, 4 * DAY))).toBe(false);
    expect(await reminders.sendDue(plus(completedAt, 4 * DAY))).toMatchObject({
      reviewReminders: 0,
    });
    expect(await takeAllEmails(app)).toEqual([]);
  });
});
