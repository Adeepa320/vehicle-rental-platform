import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminBookingSchema,
  CheckoutSessionSchema,
  PaymentListSchema,
  type AdminBooking,
  type AdminPaymentListItem,
  type Booking,
  type BookingQuote,
  type CheckoutSession,
  type Payment,
  type Vehicle,
} from '@vrp/contracts';
import {
  auditEvents,
  bookingEvents,
  bookings,
  paymentEvents,
  payments,
  runMigrations,
  vehicleHolds,
  type DatabaseHandle,
} from '@vrp/database';
import { and, asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { BookingExpiryService } from '../src/modules/bookings/booking-expiry.service';
import {
  cleanupUsers,
  emailFactory,
  findEmail,
  takeAllEmails,
  takeEmailFor,
} from './utils/auth-helpers';
import {
  getBooking,
  getProviderBooking,
  providerBookingAction,
  quoteFor,
  requestBooking,
  windowAllocator,
} from './utils/booking-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  FAKE_SECRET,
  createCheckout,
  customerPayments,
  notify,
  payAdvance,
  signedNotification,
} from './utils/payment-helpers';
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
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping payments e2e tests');

const SCOPE = 'pay';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('payments (online advance via the gateway abstraction)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let otherProvider: ProviderSession;
  let customerA: ApplicantSession;
  let customerB: ApplicantSession;
  let vehicle: Vehicle;
  const nextWindow = windowAllocator(colomboMidnight, 10);

  const holdsOf = async (bookingId: string) =>
    handle.db
      .select()
      .from(vehicleHolds)
      .where(and(eq(vehicleHolds.bookingId, bookingId), eq(vehicleHolds.kind, 'booking')));
  const paymentRows = async (bookingId: string) =>
    handle.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(asc(payments.createdAt));
  const eventActions = async (paymentId: string) =>
    (
      await handle.db
        .select()
        .from(paymentEvents)
        .where(eq(paymentEvents.paymentId, paymentId))
        .orderBy(asc(paymentEvents.createdAt), asc(paymentEvents.id))
    ).map((e) => e.action);
  const bookingVersion = async (bookingId: string) =>
    (
      await handle.db
        .select({ version: bookings.version, status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
    )[0];

  /** Request + provider accept → `accepted` (version 2) with a hold. */
  async function acceptedBooking(customer: ApplicantSession, length = 3): Promise<Booking> {
    const w = nextWindow(length);
    const booking = await requestBooking(
      app,
      customer.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      booking.id,
      'accept',
      { version: 1 },
      200,
    );
    return (await getBooking(app, customer.body.accessToken, booking.id)).body as Booking;
  }

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    // Audit rows for an unknown order have no payment / booking to cascade from; clear earlier runs.
    await handle.db.delete(paymentEvents).where(eq(paymentEvents.orderId, 'ADV-NOPE00-ZZZZ'));
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Pay Rentals Mirissa');
    otherProvider = await approvedProvider(app, nextEmail(), refs, admin, 'Other Pay Rentals');
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicle = await approvedVehicle(
      app,
      provider.body.accessToken,
      admin.body.accessToken,
      locationId,
      {
        registrationNumber: 'WP KC-5001',
      },
    );
    customerA = await newVerifiedUser(app, nextEmail());
    customerB = await newVerifiedUser(app, nextEmail());
    await takeAllEmails(app);
  });

  afterAll(async () => {
    await handle.db.delete(paymentEvents).where(eq(paymentEvents.orderId, 'ADV-NOPE00-ZZZZ'));
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('snapshots the money split on quotes and bookings (advance = 10 % of the rental)', async () => {
    const w = nextWindow(3);
    const quote = (await quoteFor(app, vehicle.id, w.startsAt, w.endsAt)).body as BookingQuote;
    expect(quote.price).toMatchObject({
      subtotal: '22500.00',
      advancePercentage: '10.00',
      advance: '2250.00',
      balanceDue: '20250.00',
      securityDeposit: '25000.00',
    });
    const booking = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    expect(booking.price).toMatchObject({ advance: '2250.00', balanceDue: '20250.00' });
    expect(booking.payment).toEqual({
      state: 'not_started',
      advanceAmount: '2250.00',
      currency: 'LKR',
      paidAt: null,
      refundDueAmount: null,
      refundedAt: null,
    });
    expect(booking.allowedActions).not.toContain('pay');
    const [row] = await handle.db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row).toMatchObject({
      advancePercentage: '10.00',
      advanceAmount: '2250.00',
      balanceDueAmount: '20250.00',
    });
    const refused = await createCheckout(app, customerA.body.accessToken, booking.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('creates a checkout with the server-side amount and reuses the open attempt on retry', async () => {
    const booking = await acceptedBooking(customerA);
    expect(booking.allowedActions).toEqual(['pay', 'cancel']);

    const first = await createCheckout(app, customerA.body.accessToken, booking.id, 200);
    expect(CheckoutSessionSchema.safeParse(first.body).success).toBe(true);
    const session = first.body as CheckoutSession;
    expect(session).toMatchObject({
      gateway: 'fake',
      method: 'POST',
      amount: '2250.00',
      currency: 'LKR',
    });
    expect(session.checkoutUrl).toBe('http://api.test/api/v1/payments/fake/checkout');
    expect(session.fields).toMatchObject({
      merchant_id: 'FAKE-MERCHANT',
      amount: '2250.00',
      currency: 'LKR',
      items: `Booking ${booking.reference} advance`,
      first_name: 'Nimal',
      last_name: 'Perera',
      email: customerA.email,
      country: 'Sri Lanka',
      custom_1: booking.id,
    });
    expect(session.fields.order_id).toMatch(/^ADV-[0-9BCDFGHJKMNPQRSTVWXYZ]{6}-[0-9A-Z]{4}$/);
    expect(session.fields.hash).toMatch(/^[0-9A-F]{32}$/);
    expect(session.fields.return_url).toBe(
      `http://localhost:3000/bookings/${booking.id}/payment?result=return`,
    );
    expect(session.fields.cancel_url).toBe(
      `http://localhost:3000/bookings/${booking.id}/payment?result=cancel`,
    );
    expect(session.fields.notify_url).toBe('http://api.test/api/v1/payments/payhere/notify');
    expect(first.text).not.toContain(FAKE_SECRET);
    expect(Object.keys(session.fields)).not.toContain('merchant_secret');

    // A client-supplied amount is ignored: the body has no schema and the amount is the snapshot.
    const retry = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking.id}/payments/checkout`)
      .set(auth(customerA.body.accessToken))
      .send({ amount: '1.00', currency: 'USD' })
      .expect(200);
    expect(retry.body.paymentId).toBe(session.paymentId);
    expect(retry.body.fields.order_id).toBe(session.fields.order_id);
    expect(retry.body.amount).toBe('2250.00');

    const rows = await paymentRows(booking.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      amount: '2250.00',
      orderId: session.fields.order_id,
    });
    expect(await eventActions(session.paymentId)).toEqual([
      'payment.checkout_created',
      'payment.checkout_issued',
      'payment.checkout_issued',
    ]);
    const list = await customerPayments(app, customerA.body.accessToken, booking.id);
    expect(PaymentListSchema.safeParse(list.body).success).toBe(true);
    expect((list.body.data as Payment[]).map((p) => p.status)).toEqual(['pending']);
    expect((await getBooking(app, customerA.body.accessToken, booking.id)).body.payment.state).toBe(
      'pending',
    );

    // Only the customer of the booking may check out or see its payments.
    await createCheckout(app, customerB.body.accessToken, booking.id, 404);
    await createCheckout(app, provider.body.accessToken, booking.id, 404);
    await createCheckout(app, otherProvider.body.accessToken, booking.id, 404);
    await customerPayments(app, customerB.body.accessToken, booking.id, 404);
    await customerPayments(app, provider.body.accessToken, booking.id, 404);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking.id}/payments/checkout`)
      .send()
      .expect(401);
  });

  it('rejects forged, mismatched and unknown notifications without touching the booking', async () => {
    const booking = await acceptedBooking(customerA);
    const session = (await createCheckout(app, customerA.body.accessToken, booking.id, 200))
      .body as CheckoutSession;
    const orderId = session.fields.order_id as string;
    const base = { orderId, amount: '2250.00' };
    await takeAllEmails(app); // request/accept mail; nothing below may add to it

    await notify(
      app,
      signedNotification({ ...base, tamper: { md5sig: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF' } }),
    );
    await notify(app, signedNotification({ ...base, secret: 'not-the-merchant-secret' }));
    await notify(app, signedNotification({ ...base, tamper: { payhere_amount: '1.00' } })); // signature no longer matches
    await notify(app, signedNotification({ ...base, merchantId: '999999' }));
    await notify(app, { order_id: orderId, status_code: '2' });
    await notify(app, {});

    expect(await bookingVersion(booking.id)).toEqual({ version: 2, status: 'accepted' });
    const [row] = await paymentRows(booking.id);
    expect(row).toMatchObject({
      status: 'pending',
      anomaly: null,
      requiresManualResolution: false,
    });
    const rejected = await handle.db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.paymentId, row?.id as string),
          eq(paymentEvents.action, 'payment.notification_rejected'),
        ),
      );
    expect(rejected.map((e) => e.metadata?.reason)).toEqual([
      'invalid_signature',
      'invalid_signature',
      'invalid_signature',
      'merchant_mismatch',
      'invalid_signature',
    ]);
    expect(
      rejected.every(
        (e) => e.signatureValid === false || e.metadata?.reason === 'merchant_mismatch',
      ),
    ).toBe(true);

    // Unknown order: logged with no payment attached.
    await notify(app, signedNotification({ orderId: 'ADV-NOPE00-ZZZZ', amount: '2250.00' }));
    const unknown = await handle.db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.orderId, 'ADV-NOPE00-ZZZZ'));
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ paymentId: null, signatureValid: true });
    expect(unknown[0]?.metadata).toMatchObject({ reason: 'unknown_order' });

    // Valid signature, wrong amount → anomaly, no confirmation; wrong currency likewise.
    await notify(app, signedNotification({ ...base, amount: '1.00' }));
    let [after] = await paymentRows(booking.id);
    expect(after).toMatchObject({
      status: 'pending',
      anomaly: 'amount_mismatch',
      requiresManualResolution: true,
    });
    await notify(app, signedNotification({ ...base, currency: 'USD' }));
    [after] = await paymentRows(booking.id);
    expect(after).toMatchObject({
      status: 'pending',
      anomaly: 'currency_mismatch',
      requiresManualResolution: true,
    });
    expect(await bookingVersion(booking.id)).toEqual({ version: 2, status: 'accepted' });
    expect((await getBooking(app, customerA.body.accessToken, booking.id)).body.status).toBe(
      'accepted',
    );
    expect(await takeAllEmails(app)).toEqual([]);

    // The eventual matching success still confirms and clears the mismatch flag.
    await notify(app, signedNotification(base));
    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'confirmed' });
    [after] = await paymentRows(booking.id);
    expect(after).toMatchObject({ status: 'paid', anomaly: null, requiresManualResolution: false });
  });

  it('confirms the booking exactly once on a verified success and survives replays and stale messages', async () => {
    const booking = await acceptedBooking(customerA);
    for (const token of [customerA.body.accessToken, provider.body.accessToken]) {
      await request(app.getHttpServer())
        .get(`/api/v1/bookings/${booking.id}/contact`)
        .set(auth(token))
        .expect(403);
    }
    const session = (await createCheckout(app, customerA.body.accessToken, booking.id, 200))
      .body as CheckoutSession;
    const orderId = session.fields.order_id as string;
    const success = signedNotification({
      orderId,
      amount: '2250.00',
      gatewayPaymentId: 'PH-ONCE-1',
    });
    await takeAllEmails(app); // request/accept mail from the set-up above

    // Three identical deliveries at once, then two more later: one confirmation.
    await Promise.all([notify(app, success), notify(app, success), notify(app, success)]);
    await notify(app, success);
    await notify(app, success);

    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'confirmed' });
    const rows = await paymentRows(booking.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'PH-ONCE-1',
      gatewayStatusCode: '2',
      gatewayMethod: 'VISA',
      anomaly: null,
    });
    expect(rows[0]?.paidAt).not.toBeNull();
    const actions = await eventActions(session.paymentId);
    expect(actions.filter((a) => a === 'payment.paid')).toHaveLength(1);
    expect(actions.filter((a) => a === 'payment.booking_confirmed')).toHaveLength(1);
    expect(actions.filter((a) => a === 'payment.notification_replayed')).toHaveLength(4);
    expect(actions.filter((a) => a === 'payment.notification_received')).toHaveLength(5);
    expect(JSON.stringify(actions)).not.toContain('card');

    const mine = (await getBooking(app, customerA.body.accessToken, booking.id)).body as Booking;
    expect(mine).toMatchObject({
      status: 'confirmed',
      confirmationSource: 'payment',
      payment: { state: 'paid', advanceAmount: '2250.00', refundDueAmount: null },
      contact: { available: true },
    });
    expect(mine.payment.paidAt).not.toBeNull();
    expect(mine.allowedActions).toEqual(['cancel', 'reveal_contact']);
    expect(mine.events.filter((e) => e.action === 'booking.confirmed')).toHaveLength(1);
    expect(mine.events.find((e) => e.action === 'booking.confirmed')?.metadata).toEqual({
      source: 'payment',
      gateway: 'fake',
      amount: '2250.00',
      currency: 'LKR',
    });
    // The stored row keeps the internal ids for audit; no customer or provider JSON carries them.
    const [storedConfirmation] = await handle.db
      .select()
      .from(bookingEvents)
      .where(
        and(eq(bookingEvents.bookingId, booking.id), eq(bookingEvents.action, 'booking.confirmed')),
      );
    expect(storedConfirmation?.metadata).toMatchObject({
      paymentId: session.paymentId,
      amount: '2250.00',
    });
    const internalIds = [
      session.paymentId,
      orderId,
      'PH-ONCE-1',
      session.fields.hash as string,
      String(storedConfirmation?.metadata?.holdId),
    ];
    for (const internal of internalIds) {
      expect(JSON.stringify(mine)).not.toContain(internal);
    }
    expect(await holdsOf(booking.id)).toHaveLength(1);
    const audit = await handle.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'booking'), eq(auditEvents.targetId, booking.id)));
    expect(audit.map((e) => e.action)).toEqual(['booking.confirmed_by_payment']);

    const mails = await takeAllEmails(app);
    expect(mails.filter((m) => m.subject.includes('confirmed'))).toHaveLength(2);
    expect(findEmail(mails, customerA.email, 'confirmed')?.text).toContain(
      'Advance received online: LKR 2,250',
    );
    expect(findEmail(mails, customerA.email, 'confirmed')?.text).toContain(
      'LKR 20,250 rental balance',
    );
    expect(findEmail(mails, provider.email, 'confirmed')).toBeDefined();

    // Contact reveal unlocks for both sides only now.
    for (const token of [customerA.body.accessToken, provider.body.accessToken]) {
      await request(app.getHttpServer())
        .get(`/api/v1/bookings/${booking.id}/contact`)
        .set(auth(token))
        .expect(200);
    }
    const theirs = (await getProviderBooking(app, provider.body.accessToken, booking.id))
      .body as Booking;
    expect(theirs.payment).toMatchObject({ state: 'paid', advanceAmount: '2250.00' });
    expect(theirs.events.find((e) => e.action === 'booking.confirmed')?.metadata).toEqual({
      source: 'payment',
      gateway: 'fake',
      amount: '2250.00',
      currency: 'LKR',
    });
    for (const internal of internalIds) {
      expect(JSON.stringify(theirs)).not.toContain(internal);
    }
    // Admin troubleshooting keeps every identifier it needs.
    const asAdmin = (
      await request(app.getHttpServer())
        .get(`/api/v1/admin/bookings/${booking.id}`)
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body as AdminBooking;
    expect(AdminBookingSchema.safeParse(asAdmin).success).toBe(true);
    expect(asAdmin.events.find((e) => e.action === 'booking.confirmed')?.metadata).toMatchObject({
      paymentId: session.paymentId,
      source: 'payment',
    });
    expect(asAdmin.payments[0]).toMatchObject({
      id: session.paymentId,
      orderId,
      gatewayPaymentId: 'PH-ONCE-1',
      status: 'paid',
    });

    // A later failure, cancel or pending message never downgrades the verified success.
    await notify(
      app,
      signedNotification({
        orderId,
        amount: '2250.00',
        statusCode: '-2',
        gatewayPaymentId: 'PH-ONCE-1',
      }),
    );
    await notify(
      app,
      signedNotification({
        orderId,
        amount: '2250.00',
        statusCode: '-1',
        gatewayPaymentId: 'PH-ONCE-1',
      }),
    );
    await notify(
      app,
      signedNotification({
        orderId,
        amount: '2250.00',
        statusCode: '0',
        gatewayPaymentId: 'PH-ONCE-1',
      }),
    );
    expect((await paymentRows(booking.id))[0]).toMatchObject({ status: 'paid', anomaly: null });
    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'confirmed' });
    expect(
      (await eventActions(session.paymentId)).filter((a) => a === 'payment.notification_ignored'),
    ).toHaveLength(2);

    // A different "success" for the same order is a duplicate-payment anomaly, never a second confirmation.
    await notify(
      app,
      signedNotification({ orderId, amount: '2250.00', gatewayPaymentId: 'PH-ONCE-2' }),
    );
    expect((await paymentRows(booking.id))[0]).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'PH-ONCE-1',
      anomaly: 'duplicate_payment',
      requiresManualResolution: true,
    });
    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'confirmed' });

    // A chargeback flags the paid advance for a human; the booking is not touched here.
    await notify(
      app,
      signedNotification({
        orderId,
        amount: '2250.00',
        statusCode: '-3',
        gatewayPaymentId: 'PH-ONCE-1',
      }),
    );
    expect((await paymentRows(booking.id))[0]).toMatchObject({
      status: 'paid',
      anomaly: 'chargeback',
      requiresManualResolution: true,
    });

    const again = await createCheckout(app, customerA.body.accessToken, booking.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_PAID');
    const adminView = await request(app.getHttpServer())
      .get(`/api/v1/admin/bookings/${booking.id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminBookingSchema.safeParse(adminView.body).success).toBe(true);
    expect(adminView.body.payments[0]).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'PH-ONCE-1',
      orderId,
      anomaly: 'chargeback',
    });
    expect(adminView.body.payments[0].events.length).toBeGreaterThan(5);
  });

  it('keeps the booking accepted after failed or cancelled payments and lets the customer retry', async () => {
    const booking = await acceptedBooking(customerA);
    const first = (await createCheckout(app, customerA.body.accessToken, booking.id, 200))
      .body as CheckoutSession;
    await notify(
      app,
      signedNotification({
        orderId: first.fields.order_id as string,
        amount: '2250.00',
        statusCode: '-2',
        statusMessage: 'Insufficient funds',
      }),
    );
    let rows = await paymentRows(booking.id);
    expect(rows[0]).toMatchObject({ status: 'failed', failureReason: 'Insufficient funds' });
    expect(rows[0]?.failedAt).not.toBeNull();
    expect(await bookingVersion(booking.id)).toEqual({ version: 2, status: 'accepted' });
    let view = (await getBooking(app, customerA.body.accessToken, booking.id)).body as Booking;
    expect(view.payment.state).toBe('failed');
    expect(view.allowedActions).toEqual(['pay', 'cancel']);
    expect((await takeEmailFor(app, customerA.email, 'Payment failed'))?.text).toMatch(
      /try again/i,
    );

    const second = (await createCheckout(app, customerA.body.accessToken, booking.id, 200))
      .body as CheckoutSession;
    expect(second.paymentId).not.toBe(first.paymentId);
    expect(second.fields.order_id).not.toBe(first.fields.order_id);
    await notify(
      app,
      signedNotification({
        orderId: second.fields.order_id as string,
        amount: '2250.00',
        statusCode: '-1',
      }),
    );
    rows = await paymentRows(booking.id);
    expect(rows.map((r) => r.status)).toEqual(['failed', 'cancelled']);
    view = (await getBooking(app, customerA.body.accessToken, booking.id)).body as Booking;
    expect(view.payment.state).toBe('cancelled');
    expect(await takeEmailFor(app, customerA.email, 'Payment cancelled')).toBeDefined();

    // Replaying the failure is harmless; a pending (0) message changes nothing.
    await notify(
      app,
      signedNotification({
        orderId: second.fields.order_id as string,
        amount: '2250.00',
        statusCode: '-1',
      }),
    );
    await notify(
      app,
      signedNotification({
        orderId: second.fields.order_id as string,
        amount: '2250.00',
        statusCode: '0',
      }),
    );
    expect((await paymentRows(booking.id)).map((r) => r.status)).toEqual(['failed', 'cancelled']);

    const { booking: paid } = await payAdvance(app, customerA.body.accessToken, booking.id);
    expect(paid.status).toBe('confirmed');
    rows = await paymentRows(booking.id);
    expect(rows.map((r) => r.status)).toEqual(['failed', 'cancelled', 'paid']);
    expect(
      (await customerPayments(app, customerA.body.accessToken, booking.id)).body.data,
    ).toHaveLength(3);
  });

  it('cancels the open attempt when the acceptance expires and treats a late success as an anomaly', async () => {
    const expiry = app.get(BookingExpiryService);
    const booking = await acceptedBooking(customerB);
    const session = (await createCheckout(app, customerB.body.accessToken, booking.id, 200))
      .body as CheckoutSession;
    const orderId = session.fields.order_id as string;

    const due = new Date(Date.parse(booking.confirmBy as string) + 1000);
    expect((await expiry.expireDue(due)).acceptancesExpired).toBeGreaterThanOrEqual(1);
    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'expired' });
    expect(await holdsOf(booking.id)).toHaveLength(0);
    let [row] = await paymentRows(booking.id);
    expect(row).toMatchObject({ status: 'cancelled', failureReason: 'booking_expired' });
    const closed = await createCheckout(app, customerB.body.accessToken, booking.id);
    expect(closed.status).toBe(409);
    await takeAllEmails(app);

    // Another customer books the freed window; then PayHere delivers the first customer's late success.
    const startsAt = booking.startsAt;
    const endsAt = booking.endsAt;
    const rebooked = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      startsAt,
      endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      rebooked.id,
      'accept',
      { version: 1 },
      200,
    );
    await notify(
      app,
      signedNotification({ orderId, amount: '2250.00', gatewayPaymentId: 'PH-LATE-1' }),
    );

    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'expired' });
    expect(await holdsOf(booking.id)).toHaveLength(0);
    [row] = await paymentRows(booking.id);
    expect(row).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'PH-LATE-1',
      anomaly: 'late_success',
      requiresManualResolution: true,
      refundDueAmount: '2250.00',
    });
    expect((await eventActions(session.paymentId)).at(-1)).toBe('payment.anomaly');
    expect(await bookingVersion(rebooked.id)).toEqual({ version: 2, status: 'accepted' });
    expect(await holdsOf(rebooked.id)).toHaveLength(1);
    const mails = await takeAllEmails(app);
    expect(findEmail(mails, customerB.email, 'received after the booking closed')?.text).toContain(
      'LKR 2,250',
    );
    expect(mails.filter((m) => m.subject.includes('confirmed'))).toHaveLength(0);

    // The late payment shows up in the admin queue and the customer's own list.
    const queue = await request(app.getHttpServer())
      .get('/api/v1/admin/payments')
      .set(auth(admin.body.accessToken))
      .expect(200);
    const flagged = (queue.body.data as AdminPaymentListItem[]).find(
      (p) => p.id === session.paymentId,
    );
    expect(flagged).toMatchObject({ anomaly: 'late_success', bookingReference: booking.reference });
    expect(
      (await customerPayments(app, customerB.body.accessToken, booking.id)).body.data[0],
    ).toMatchObject({ status: 'paid', anomaly: 'late_success' });
    // The customer's booking view says the money is owed back, not 'advance not paid'.
    expect(
      ((await getBooking(app, customerB.body.accessToken, booking.id)).body as Booking).payment,
    ).toMatchObject({
      state: 'refund_due',
      refundDueAmount: '2250.00',
      paidAt: expect.any(String),
    });

    // An admin resolves it (refund outside the platform) by recording the refund.
    const refund = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${session.paymentId}/refund`)
      .set(auth(admin.body.accessToken))
      .send({
        mode: 'manual',
        amount: '2250.00',
        reason: 'Late payment after expiry; refunded via PayHere portal',
        reference: 'PH-REF-001',
      })
      .expect(200);
    expect(refund.body).toMatchObject({
      status: 'refunded',
      refundedAmount: '2250.00',
      refundReference: 'PH-REF-001',
      requiresManualResolution: false,
    });
    expect(findEmail(await takeAllEmails(app), customerB.email, 'Refund')?.text).toContain(
      'PH-REF-001',
    );
  });

  it('flags a refund after cancellation of a paid booking and records the admin refund', async () => {
    // Customer cancels far ahead of pickup (≥ 48 h) → full refund due.
    const booking = await acceptedBooking(customerA);
    const { checkout } = await payAdvance(app, customerA.body.accessToken, booking.id);
    await takeAllEmails(app);
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(auth(customerA.body.accessToken))
      .send({ version: 3, note: 'Plans changed' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled_by_customer',
      payment: { state: 'refund_due', refundDueAmount: '2250.00', refundedAt: null },
    });
    expect(await holdsOf(booking.id)).toHaveLength(0);
    let [row] = await paymentRows(booking.id);
    expect(row).toMatchObject({
      status: 'paid',
      refundDueAmount: '2250.00',
      anomaly: 'refund_due',
      requiresManualResolution: true,
    });
    expect(cancelled.body.events.at(-1)?.metadata).toMatchObject({ refundDueAmount: '2250.00' });
    let mails = await takeAllEmails(app);
    expect(findEmail(mails, customerA.email, 'will be refunded')?.text).toContain('LKR 2,250');
    expect(findEmail(mails, provider.email, 'was cancelled')).toBeDefined();

    // Partial refund keeps the payment paid; a second partial completes it; over-refunds are refused.
    const paymentId = checkout.paymentId;
    const tooMuch = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set(auth(admin.body.accessToken))
      .send({
        mode: 'manual',
        amount: '3000.00',
        reason: 'Full refund per policy',
        reference: 'BT-1',
      })
      .expect(400);
    expect(tooMuch.body.error.details[0].field).toBe('amount');
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set(auth(admin.body.accessToken))
      .send({ mode: 'manual', amount: '1000.00', reason: 'First instalment', reference: 'BT-1' })
      .expect(200);
    [row] = await paymentRows(booking.id);
    expect(row).toMatchObject({
      status: 'paid',
      refundedAmount: '1000.00',
      requiresManualResolution: false,
    });
    const done = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set(auth(admin.body.accessToken))
      .send({ mode: 'manual', amount: '1250.00', reason: 'Remainder', reference: 'BT-2' })
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'refunded',
      refundedAmount: '2250.00',
      refundReference: 'BT-2',
    });
    expect((await getBooking(app, customerA.body.accessToken, booking.id)).body.payment.state).toBe(
      'refunded',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set(auth(admin.body.accessToken))
      .send({ mode: 'manual', amount: '1.00', reason: 'Already refunded', reference: 'BT-3' })
      .expect(409);
    const audit = await handle.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'payment'), eq(auditEvents.targetId, paymentId)));
    expect(audit.map((e) => e.action)).toEqual([
      'payment.refund_recorded',
      'payment.refund_recorded',
    ]);
    expect(
      findEmail(await takeAllEmails(app), customerA.email, 'Refund of LKR 1,250'),
    ).toBeDefined();

    // Gateway refund and reconciliation need merchant-API credentials; the fake gateway has none.
    const gatewayRefund = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set(auth(admin.body.accessToken))
      .send({ mode: 'gateway', amount: '1.00', reason: 'Testing gateway mode' });
    expect([409, 503]).toContain(gatewayRefund.status);
    const reconcile = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/reconcile`)
      .set(auth(admin.body.accessToken))
      .expect(503);
    expect(reconcile.body.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');

    // Provider cancellation of a paid booking: full refund due regardless of timing.
    const b2 = await acceptedBooking(customerB);
    await payAdvance(app, customerB.body.accessToken, b2.id);
    await takeAllEmails(app);
    const byProvider = await providerBookingAction(
      app,
      provider.body.accessToken,
      b2.id,
      'cancel',
      { version: 3, note: 'Engine trouble' },
      200,
    );
    expect(byProvider.body.payment).toMatchObject({
      state: 'refund_due',
      refundDueAmount: '2250.00',
    });
    mails = await takeAllEmails(app);
    expect(findEmail(mails, customerB.email, 'was cancelled')?.text).toContain('will be refunded');

    // Customer cancellation inside the 48-hour window forfeits the advance (no refund due).
    const b3 = await acceptedBooking(customerB);
    await payAdvance(app, customerB.body.accessToken, b3.id);
    await takeAllEmails(app);
    await handle.db
      .update(bookings)
      .set({
        startsAt: new Date(Date.now() + 10 * 3_600_000),
        endsAt: new Date(Date.now() + 34 * 3_600_000),
      })
      .where(eq(bookings.id, b3.id));
    const late = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${b3.id}/cancel`)
      .set(auth(customerB.body.accessToken))
      .send({ version: 3 })
      .expect(200);
    expect(late.body.payment).toMatchObject({ state: 'forfeited', refundDueAmount: null });
    [row] = await paymentRows(b3.id);
    expect(row).toMatchObject({
      status: 'paid',
      refundDueAmount: '0.00',
      requiresManualResolution: false,
    });
    expect(findEmail(await takeAllEmails(app), customerB.email, 'not refundable')).toBeDefined();

    // Resolving without a refund clears the flag on an anomaly.
    const chargeback = await acceptedBooking(customerA);
    const { checkout: c } = await payAdvance(app, customerA.body.accessToken, chargeback.id);
    await notify(
      app,
      signedNotification({
        orderId: c.fields.order_id as string,
        amount: '2250.00',
        statusCode: '-3',
        gatewayPaymentId: (await paymentRows(chargeback.id))[0]?.gatewayPaymentId as string,
      }),
    );
    const resolved = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${c.paymentId}/resolve`)
      .set(auth(admin.body.accessToken))
      .send({ note: 'Chargeback contested and won' })
      .expect(200);
    expect(resolved.body).toMatchObject({ requiresManualResolution: false, anomaly: 'chargeback' });
  });

  it('serves the fake gateway simulator and keeps admin payment routes to admins', async () => {
    const booking = await acceptedBooking(customerA);
    const session = (await createCheckout(app, customerA.body.accessToken, booking.id, 200))
      .body as CheckoutSession;
    const page = await request(app.getHttpServer())
      .post('/api/v1/payments/fake/checkout')
      .type('form')
      .send(session.fields)
      .expect(200);
    expect(page.text).toContain(session.fields.order_id);
    expect(page.text).toContain('Pay successfully');
    const complete = await request(app.getHttpServer())
      .post('/api/v1/payments/fake/complete')
      .type('form')
      .send({ ...session.fields, outcome: 'success' })
      .expect(303);
    expect(complete.headers.location).toBe(session.fields.return_url);
    expect(await bookingVersion(booking.id)).toEqual({ version: 3, status: 'confirmed' });
    expect((await paymentRows(booking.id))[0]).toMatchObject({
      status: 'paid',
      gatewayMethod: 'TEST',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/payments')
      .set(auth(customerA.body.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/payments')
      .set(auth(provider.body.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${session.paymentId}/refund`)
      .set(auth(provider.body.accessToken))
      .send({ mode: 'manual', amount: '1.00', reason: 'not allowed', reference: 'x' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/payments/${session.paymentId}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
  });
});
