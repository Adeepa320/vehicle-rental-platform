import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminBookingSchema,
  CancellationPreviewSchema,
  type AdminBooking,
  type Booking,
  type CancellationPreview,
} from '@vrp/contracts';
import {
  auditEvents,
  bookingEvents,
  bookings,
  notifications,
  payments,
  runMigrations,
  vehicleHolds,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { colomboDay } from '../src/common/colombo-dates';
import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, takeAllEmails } from './utils/auth-helpers';
import { providerBookingAction, requestBooking, windowAllocator } from './utils/booking-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { createCheckout, notify, payAdvance, signedNotification } from './utils/payment-helpers';
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
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin booking operations e2e tests');

const SCOPE = 'abop';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('admin booking operations (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let customer: ApplicantSession;
  let vehicleId: string;
  const nextWindow = windowAllocator(colomboMidnight, 30);

  const api = () => request(app.getHttpServer());
  const adminBooking = async (id: string): Promise<AdminBooking> => {
    const res = await api()
      .get(`/api/v1/admin/bookings/${id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminBookingSchema.safeParse(res.body).success).toBe(true);
    return res.body as AdminBooking;
  };
  const preview = async (id: string, actor: string): Promise<CancellationPreview> => {
    const res = await api()
      .get(`/api/v1/admin/bookings/${id}/cancellation-preview`)
      .query({ actor })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(CancellationPreviewSchema.safeParse(res.body).success).toBe(true);
    return res.body as CancellationPreview;
  };
  const cancel = (id: string, body: Record<string, unknown>, token = admin.body.accessToken) =>
    api().post(`/api/v1/admin/bookings/${id}/cancel`).set(auth(token)).send(body);
  const accepted = async (who: ApplicantSession = customer, length = 2): Promise<Booking> => {
    const w = nextWindow(length);
    const b = await requestBooking(app, who.body.accessToken, vehicleId, w.startsAt, w.endsAt);
    return (
      await providerBookingAction(
        app,
        provider.body.accessToken,
        b.id,
        'accept',
        { version: 1 },
        200,
      )
    ).body as Booking;
  };
  const holdsOf = (id: string) =>
    handle.db
      .select({ id: vehicleHolds.id })
      .from(vehicleHolds)
      .where(eq(vehicleHolds.bookingId, id));
  const paymentsOf = (id: string) =>
    handle.db.select().from(payments).where(eq(payments.bookingId, id));
  const auditOf = (id: string) =>
    handle.db
      .select({
        action: auditEvents.action,
        actorUserId: auditEvents.actorUserId,
        reason: auditEvents.reason,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'booking'), eq(auditEvents.targetId, id)));

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Booking Ops Rentals');
    customer = await newVerifiedUser(app, nextEmail());
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicleId = (
      await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
        registrationNumber: 'BO-3001',
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('filters the admin list by free text, rental dates and vehicle, and the detail carries the Phase 9 links', async () => {
    const booking = await accepted();
    const byRef = await api()
      .get('/api/v1/admin/bookings')
      .query({ q: booking.reference.slice(4, 8) })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(byRef.body.data.map((b: { id: string }) => b.id)).toContain(booking.id);
    const byEmail = await api()
      .get('/api/v1/admin/bookings')
      .query({ q: customer.email })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(byEmail.body.data.map((b: { id: string }) => b.id)).toContain(booking.id);
    const day = colomboDay(new Date(booking.startsAt));
    const inRange = await api()
      .get('/api/v1/admin/bookings')
      .query({ from: day, to: day, vehicleId })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(inRange.body.data.map((b: { id: string }) => b.id)).toContain(booking.id);
    const outside = await api()
      .get('/api/v1/admin/bookings')
      .query({ from: '2020-01-01', to: '2020-01-02' })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(outside.body.data.map((b: { id: string }) => b.id)).not.toContain(booking.id);
    const detail = await adminBooking(booking.id);
    expect(detail).toMatchObject({
      dispute: null,
      review: null,
      resendableTemplates: ['payment_reminder'],
    });
    await api()
      .get(`/api/v1/admin/bookings/${booking.id}`)
      .set(auth(customer.body.accessToken))
      .expect(403);
  });

  it('previews and performs a cancellation on behalf of the customer with the one refund rule', async () => {
    const booking = await accepted();
    await payAdvance(app, customer.body.accessToken, booking.id);
    const before = await preview(booking.id, 'customer');
    expect(before).toMatchObject({
      allowed: true,
      resultingStatus: 'cancelled_by_customer',
      holdWillBeReleased: true,
      advancePaid: true,
      forfeited: false,
    });
    expect(before.refundDueAmount).toBe(booking.price.advance);
    expect(await holdsOf(booking.id)).toHaveLength(1);
    await takeAllEmails(app);
    // Reason and version are mandatory; the actor must be one of the three.
    await cancel(booking.id, { actor: 'customer', version: 3 }).expect(400);
    await cancel(booking.id, { actor: 'referee', reason: 'x'.repeat(10), version: 3 }).expect(400);
    const stale = await cancel(booking.id, {
      actor: 'customer',
      reason: 'Customer phoned to cancel',
      version: 1,
    }).expect(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    await cancel(
      booking.id,
      { actor: 'customer', reason: 'Customer phoned to cancel', version: 3 },
      customer.body.accessToken,
    ).expect(403);
    const done = await cancel(booking.id, {
      actor: 'customer',
      reason: 'Customer phoned to cancel their trip',
      version: 3,
    }).expect(200);
    expect(done.body).toMatchObject({
      status: 'cancelled_by_customer',
      cancellationNote: 'Customer phoned to cancel their trip',
    });
    expect(done.body.payment).toMatchObject({
      state: 'refund_due',
      refundDueAmount: booking.price.advance,
    });
    expect(await holdsOf(booking.id)).toHaveLength(0);
    const [payment] = await paymentsOf(booking.id);
    expect(payment).toMatchObject({
      status: 'paid',
      anomaly: 'refund_due',
      requiresManualResolution: true,
      refundDueAmount: booking.price.advance,
    });
    const events = await handle.db
      .select({
        action: bookingEvents.action,
        actorType: bookingEvents.actorType,
        metadata: bookingEvents.metadata,
      })
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, booking.id));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'booking.cancelled',
          actorType: 'admin',
          metadata: expect.objectContaining({ by: 'customer', holdReleased: true }),
        }),
      ]),
    );
    expect(await auditOf(booking.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'booking.cancelled_by_admin',
          actorUserId: admin.userId,
          reason: 'Customer phoned to cancel their trip',
        }),
      ]),
    );
    const inApp = await handle.db
      .select({ userId: notifications.userId, type: notifications.type })
      .from(notifications)
      .where(eq(notifications.type, 'booking.cancelled'));
    expect(inApp.map((n) => n.userId)).toEqual(
      expect.arrayContaining([customer.userId, provider.userId]),
    );
    const mails = await takeAllEmails(app);
    expect(
      mails
        .filter((m) => m.subject.includes(booking.reference))
        .map((m) => m.to)
        .sort(),
    ).toEqual([customer.email, provider.email].sort());
    // A final booking cannot be cancelled again; the customer's own view shows the admin cancellation.
    expect((await preview(booking.id, 'customer')).allowed).toBe(false);
    await cancel(booking.id, { actor: 'customer', reason: 'again please', version: 4 }).expect(409);
    const mine = await api()
      .get(`/api/v1/bookings/${booking.id}`)
      .set(auth(customer.body.accessToken))
      .expect(200);
    expect(mine.body.status).toBe('cancelled_by_customer');
    expect(JSON.stringify(mine.body.events)).not.toContain(payment?.id as string);
  });

  it('platform cancellation refunds in full even close to pickup, provider cancellation too; customer actor forfeits', async () => {
    const close = await accepted();
    await payAdvance(app, customer.body.accessToken, close.id);
    // Move pickup to 10 hours from now (inside the 48 h window): the customer rule forfeits, the platform rule refunds.
    const soon = new Date(Date.now() + 10 * 3_600_000);
    await handle.db
      .update(bookings)
      .set({ startsAt: soon, endsAt: new Date(soon.getTime() + 2 * 86_400_000) })
      .where(eq(bookings.id, close.id));
    const asCustomer = await preview(close.id, 'customer');
    expect(asCustomer).toMatchObject({ forfeited: true, refundDueAmount: '0.00' });
    expect(asCustomer.hoursBeforePickup).toBeLessThan(48);
    const asProvider = await preview(close.id, 'provider');
    expect(asProvider).toMatchObject({
      forfeited: false,
      refundDueAmount: close.price.advance,
      resultingStatus: 'cancelled_by_provider',
    });
    const asPlatform = await preview(close.id, 'platform');
    expect(asPlatform).toMatchObject({
      forfeited: false,
      refundDueAmount: close.price.advance,
      resultingStatus: 'cancelled_by_platform',
    });
    const done = await cancel(close.id, {
      actor: 'platform',
      reason: 'Vehicle involved in an accident; operator cancelled',
      version: 3,
    }).expect(200);
    expect(done.body).toMatchObject({ status: 'cancelled_by_platform' });
    expect(done.body.payment).toMatchObject({
      state: 'refund_due',
      refundDueAmount: close.price.advance,
    });
    expect(await holdsOf(close.id)).toHaveLength(0);
    // Resend: the cancellation notice goes to the customer (platform cancellation) and is audited.
    await takeAllEmails(app);
    const resent = await api()
      .post(`/api/v1/admin/bookings/${close.id}/resend`)
      .set(auth(admin.body.accessToken))
      .send({ template: 'cancellation_notice' })
      .expect(200);
    expect(resent.body).toMatchObject({
      template: 'cancellation_notice',
      recipientRole: 'customer',
    });
    expect(resent.body.recipient).not.toBe(customer.email);
    expect(resent.body.recipient).toMatch(/^.\*\*\*@/);
    const mail = (await takeAllEmails(app)).find((m) => m.to === customer.email);
    expect(mail?.subject).toContain(close.reference);
    expect(mail?.text.toLowerCase()).toContain('platform team cancelled');
    expect(mail?.text).toContain('Vehicle involved in an accident');
  });

  it('never cancels an active rental or a completed booking through the admin route', async () => {
    const booking = await accepted();
    await payAdvance(app, customer.body.accessToken, booking.id);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      booking.id,
      'pickup',
      { version: 3 },
      200,
    );
    const active = await preview(booking.id, 'platform');
    expect(active).toMatchObject({ allowed: false, resultingStatus: null });
    expect(active.reason).toContain('in progress');
    const refused = await cancel(booking.id, {
      actor: 'platform',
      reason: 'try to cancel an active rental',
      version: 4,
    }).expect(409);
    expect(refused.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await providerBookingAction(
      app,
      provider.body.accessToken,
      booking.id,
      'return',
      { version: 4 },
      200,
    );
    await cancel(booking.id, {
      actor: 'platform',
      reason: 'try to cancel a completed rental',
      version: 5,
    }).expect(409);
    expect(await holdsOf(booking.id)).toHaveLength(1); // completed bookings keep their hold as history
    // No manual confirmation path exists.
    const fresh = await accepted();
    await api()
      .post(`/api/v1/admin/bookings/${fresh.id}/confirm-for-testing`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(404);
    await api()
      .post(`/api/v1/admin/bookings/${fresh.id}/confirm`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(404);
    await api()
      .post(`/api/v1/admin/bookings/${fresh.id}/status`)
      .set(auth(admin.body.accessToken))
      .send({ status: 'confirmed' })
      .expect(404);
    expect((await adminBooking(fresh.id)).status).toBe('accepted');
  });

  it('keeps the Phase 7 invariants when an admin cancellation races a successful payment callback', async () => {
    const booking = await accepted();
    const checkout = (await createCheckout(app, customer.body.accessToken, booking.id, 200))
      .body as { fields: Record<string, string> };
    const fields = signedNotification({
      orderId: checkout.fields.order_id as string,
      amount: checkout.fields.amount as string,
    });
    const [cancelRes, notifyRes] = await Promise.all([
      cancel(booking.id, {
        actor: 'platform',
        reason: 'Operational cancellation racing the callback',
        version: 2,
      }),
      notify(app, fields),
    ]);
    expect(notifyRes.status).toBe(200);
    const [row] = await handle.db
      .select({ status: bookings.status, version: bookings.version })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    const [payment] = await paymentsOf(booking.id);
    if (cancelRes.status === 200) {
      // Cancellation won: the verified success is real money → paid with a late-success anomaly and a refund due; never re-confirmed.
      expect(row?.status).toBe('cancelled_by_platform');
      expect(payment).toMatchObject({
        status: 'paid',
        anomaly: 'late_success',
        requiresManualResolution: true,
        refundDueAmount: checkout.fields.amount,
      });
    } else {
      // Payment won: the admin's version was stale (409); the booking is confirmed and a retry cancels it under the platform rule.
      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.error.code).toBe('STALE_VERSION');
      expect(row?.status).toBe('confirmed');
      expect(payment?.status).toBe('paid');
      const retry = await cancel(booking.id, {
        actor: 'platform',
        reason: 'Operational cancellation after confirmation',
        version: row?.version as number,
      }).expect(200);
      expect(retry.body).toMatchObject({ status: 'cancelled_by_platform' });
      expect(retry.body.payment).toMatchObject({
        state: 'refund_due',
        refundDueAmount: checkout.fields.amount,
      });
    }
    expect(await holdsOf(booking.id)).toHaveLength(0);
    // A replayed callback changes nothing and recreates no hold.
    await notify(app, fields);
    const [after] = await handle.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(after?.status).toBe('cancelled_by_platform');
    expect(await holdsOf(booking.id)).toHaveLength(0);
    expect((await paymentsOf(booking.id)).filter((p) => p.status === 'paid')).toHaveLength(1);
  });

  it('re-sends only allow-listed templates that fit the state, to a server-derived recipient', async () => {
    const booking = await accepted();
    await takeAllEmails(app);
    await api()
      .post(`/api/v1/admin/bookings/${booking.id}/resend`)
      .set(auth(customer.body.accessToken))
      .send({ template: 'payment_reminder' })
      .expect(403);
    await api()
      .post(`/api/v1/admin/bookings/${booking.id}/resend`)
      .set(auth(provider.body.accessToken))
      .send({ template: 'payment_reminder' })
      .expect(403);
    await api()
      .post(`/api/v1/admin/bookings/${booking.id}/resend`)
      .set(auth(admin.body.accessToken))
      .send({ template: 'marketing_blast' })
      .expect(400);
    await api()
      .post(`/api/v1/admin/bookings/${booking.id}/resend`)
      .set(auth(admin.body.accessToken))
      .send({ template: 'payment_reminder', to: 'attacker@example.com', subject: 'x', body: 'y' })
      .expect(400);
    const wrongState = await api()
      .post(`/api/v1/admin/bookings/${booking.id}/resend`)
      .set(auth(admin.body.accessToken))
      .send({ template: 'booking_confirmation' })
      .expect(409);
    expect(wrongState.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const ok = await api()
      .post(`/api/v1/admin/bookings/${booking.id}/resend`)
      .set(auth(admin.body.accessToken))
      .send({ template: 'payment_reminder' })
      .expect(200);
    expect(ok.body).toMatchObject({ template: 'payment_reminder', recipientRole: 'customer' });
    const mails = await takeAllEmails(app);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe(customer.email);
    expect(mails[0]?.subject).toContain(booking.reference);
    expect(mails[0]?.text).not.toContain(provider.email);
    expect(await auditOf(booking.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'booking.notification_resent',
          actorUserId: admin.userId,
          metadata: { template: 'payment_reminder', recipientRole: 'customer' },
        }),
      ]),
    );
    // No in-app duplicate is created by a resend.
    const feed = await handle.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.userId, customer.userId), eq(notifications.type, 'payment.reminder')),
      );
    expect(feed).toHaveLength(0);
    // After confirmation the applicable set changes.
    await payAdvance(app, customer.body.accessToken, booking.id);
    expect((await adminBooking(booking.id)).resendableTemplates).toEqual([
      'booking_confirmation',
      'pickup_reminder',
    ]);
  });
});
