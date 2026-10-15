import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminDisputeListSchema,
  AdminDisputeSchema,
  BookingDisputeStateSchema,
  DisputeSchema,
  type AdminDispute,
  type Booking,
  type Dispute,
} from '@vrp/contracts';
import {
  auditEvents,
  bookings,
  disputeMessages,
  notifications,
  payments,
  runMigrations,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, takeAllEmails } from './utils/auth-helpers';
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
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping disputes e2e tests');

const SCOPE = 'dspt';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DESCRIPTION =
  'The car had a deep scratch on the left door that was not on the listing photos.';

describe.skipIf(!url)('disputes (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let customer: ApplicantSession;
  let stranger: ApplicantSession;
  let vehicleId: string;
  const nextWindow = windowAllocator(colomboMidnight, 40);

  const api = () => request(app.getHttpServer());
  const completed = async (who: ApplicantSession = customer): Promise<Booking> => {
    const w = nextWindow(2);
    const b = await requestBooking(app, who.body.accessToken, vehicleId, w.startsAt, w.endsAt);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'accept',
      { version: 1 },
      200,
    );
    await payAdvance(app, who.body.accessToken, b.id);
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
  const state = async (token: string, bookingId: string, expected = 200) => {
    const res = await api()
      .get(`/api/v1/bookings/${bookingId}/dispute`)
      .set(auth(token))
      .expect(expected);
    if (expected === 200) expect(BookingDisputeStateSchema.safeParse(res.body).success).toBe(true);
    return res.body;
  };
  const open = (
    token: string,
    bookingId: string,
    body: Record<string, unknown> = { reasonCode: 'vehicle_condition', description: DESCRIPTION },
  ) => api().post(`/api/v1/bookings/${bookingId}/dispute`).set(auth(token)).send(body);
  const message = (token: string, disputeId: string, body: string) =>
    api().post(`/api/v1/disputes/${disputeId}/messages`).set(auth(token)).send({ body });
  const adminGet = async (id: string): Promise<AdminDispute> => {
    const res = await api()
      .get(`/api/v1/admin/disputes/${id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminDisputeSchema.safeParse(res.body).success).toBe(true);
    return res.body as AdminDispute;
  };
  const auditOf = (id: string) =>
    handle.db
      .select({
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        actorUserId: auditEvents.actorUserId,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'dispute'), eq(auditEvents.targetId, id)));
  const feed = (userId: string, type: string) =>
    handle.db
      .select({ id: notifications.id, body: notifications.body })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Dispute Rentals');
    customer = await newVerifiedUser(app, nextEmail());
    stranger = await newVerifiedUser(app, nextEmail());
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicleId = (
      await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
        registrationNumber: 'DS-4001',
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('lets a participant open the one dispute of an eligible booking and keeps strangers out', async () => {
    const booking = await completed();
    await state(stranger.body.accessToken, booking.id, 404);
    await open(stranger.body.accessToken, booking.id).expect(404);
    const before = await state(customer.body.accessToken, booking.id);
    expect(before).toMatchObject({ eligible: true, reason: null, dispute: null });
    expect(before.windowClosesAt).not.toBeNull();
    await open(customer.body.accessToken, booking.id, {
      reasonCode: 'vehicle_condition',
      description: 'too short',
    }).expect(400);
    await open(customer.body.accessToken, booking.id, {
      reasonCode: 'vehicle_condition',
      description: DESCRIPTION,
      bookingOwnerId: stranger.userId,
    }).expect(400);
    await open(customer.body.accessToken, booking.id, {
      reasonCode: 'vehicle_condition',
      description: DESCRIPTION,
      status: 'resolved',
    }).expect(400);
    await takeAllEmails(app);
    const opened = await open(customer.body.accessToken, booking.id).expect(201);
    expect(DisputeSchema.safeParse(opened.body).success).toBe(true);
    const dispute = opened.body as Dispute;
    expect(dispute).toMatchObject({
      bookingId: booking.id,
      openedBy: 'customer',
      openedByMe: true,
      status: 'open',
      reasonCode: 'vehicle_condition',
      description: DESCRIPTION,
      messages: [],
      canMessage: true,
    });
    expect(JSON.stringify(dispute)).not.toMatch(/internal|email|phone|assignedAdmin/);
    const duplicate = await open(customer.body.accessToken, booking.id).expect(409);
    expect(duplicate.body.error.code).toBe('DISPUTE_ALREADY_EXISTS');
    await open(provider.body.accessToken, booking.id).expect(409);
    expect(await state(customer.body.accessToken, booking.id)).toMatchObject({
      eligible: false,
      reason: 'already_exists',
      dispute: { id: dispute.id },
    });
    // The provider is told (in-app + e-mail) and sees the dispute as the counterparty.
    expect(await feed(provider.userId, 'dispute.opened')).toHaveLength(1);
    const mails = await takeAllEmails(app);
    expect(mails.find((m) => m.to === provider.email)?.subject).toContain('dispute');
    expect(mails.find((m) => m.to === customer.email)).toBeUndefined();
    const providerView = (
      await api()
        .get(`/api/v1/disputes/${dispute.id}`)
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body as Dispute;
    expect(providerView.openedByMe).toBe(false);
    await api()
      .get(`/api/v1/disputes/${dispute.id}`)
      .set(auth(stranger.body.accessToken))
      .expect(404);
    expect(await auditOf(dispute.id)).toEqual([
      expect.objectContaining({
        action: 'dispute.opened',
        actorType: 'customer',
        actorUserId: customer.userId,
      }),
    ]);
  });

  it('refuses disputes on the wrong state and outside the window', async () => {
    const w = nextWindow(2);
    const requested = await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w.startsAt,
      w.endsAt,
    );
    expect(await state(customer.body.accessToken, requested.id)).toMatchObject({
      eligible: false,
      reason: 'not_disputable_status',
    });
    const wrong = await open(customer.body.accessToken, requested.id).expect(409);
    expect(wrong.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const old = await completed();
    await handle.db
      .update(bookings)
      .set({ completedAt: new Date(Date.now() - 20 * 86_400_000) })
      .where(eq(bookings.id, old.id));
    expect(await state(provider.body.accessToken, old.id)).toMatchObject({
      eligible: false,
      reason: 'window_closed',
    });
    const late = await open(provider.body.accessToken, old.id).expect(409);
    expect(late.body.error.code).toBe('DISPUTE_WINDOW_CLOSED');
    // Cancelled bookings are disputable by either side within the window.
    const w2 = nextWindow(2);
    const cancelled = await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w2.startsAt,
      w2.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      cancelled.id,
      'accept',
      { version: 1 },
      200,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      cancelled.id,
      'cancel',
      { version: 2 },
      200,
    );
    const byProvider = await open(provider.body.accessToken, cancelled.id, {
      reasonCode: 'cancellation_issue',
      description: 'Customer agreed to a different date by phone, then disputed the cancellation.',
    }).expect(201);
    expect(byProvider.body.openedBy).toBe('provider');
  });

  it('runs the thread, hides the internal note from participants and resolves without touching payments', async () => {
    const booking = await completed();
    const dispute = (await open(customer.body.accessToken, booking.id).expect(201)).body as Dispute;
    await takeAllEmails(app);
    await message(stranger.body.accessToken, dispute.id, 'I was not there').expect(404);
    const fromProvider = (
      await message(
        provider.body.accessToken,
        dispute.id,
        'The scratch was there at handover and is on our pickup photos.',
      ).expect(201)
    ).body as Dispute;
    expect(fromProvider.messages).toHaveLength(1);
    expect(fromProvider.messages[0]).toMatchObject({ authorRole: 'provider', authorName: 'You' });
    const customerView = (
      await api()
        .get(`/api/v1/disputes/${dispute.id}`)
        .set(auth(customer.body.accessToken))
        .expect(200)
    ).body as Dispute;
    expect(customerView.messages[0]?.authorName).toBe('Dispute Rentals');
    expect(await feed(customer.userId, 'dispute.message')).toHaveLength(1);
    const fromCustomer = (
      await message(
        customer.body.accessToken,
        dispute.id,
        'The pickup photos were taken after I pointed it out.',
      ).expect(201)
    ).body as Dispute;
    expect(fromCustomer.messages.map((m) => m.authorName)).toEqual(['Dispute Rentals', 'You']);
    const providerView = (
      await api()
        .get(`/api/v1/disputes/${dispute.id}`)
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body as Dispute;
    expect(providerView.messages.map((m) => m.authorName)).toEqual(['You', 'Nimal']);
    expect(JSON.stringify(providerView)).not.toContain(customer.email);

    // Admin: queue, detail, internal note (never visible to participants, nobody notified), review, public message.
    const queue = await api()
      .get('/api/v1/admin/disputes')
      .query({ status: 'open' })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminDisputeListSchema.safeParse(queue.body).success).toBe(true);
    expect(queue.body.data.find((d: { id: string }) => d.id === dispute.id)).toMatchObject({
      messageCount: 2,
      bookingReference: booking.reference,
      customerName: 'Nimal Perera',
    });
    await api().get('/api/v1/admin/disputes').set(auth(customer.body.accessToken)).expect(403);
    await api().get('/api/v1/admin/disputes').set(auth(provider.body.accessToken)).expect(403);
    const note = 'INTERNAL: provider has two prior complaints; lean towards the customer.';
    await takeAllEmails(app); // drain the thread mails so the note can be shown to send nothing
    await api()
      .put(`/api/v1/admin/disputes/${dispute.id}/internal-note`)
      .set(auth(admin.body.accessToken))
      .send({ note })
      .expect(200);
    expect((await adminGet(dispute.id)).internalAdminNote).toBe(note);
    for (const token of [customer.body.accessToken, provider.body.accessToken]) {
      const view = await api().get(`/api/v1/disputes/${dispute.id}`).set(auth(token)).expect(200);
      expect(JSON.stringify(view.body)).not.toContain('INTERNAL');
    }
    expect(await takeAllEmails(app)).toHaveLength(0);
    const inReview = await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/start-review`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(200);
    expect(inReview.body).toMatchObject({ status: 'in_review', assignedAdminId: admin.userId });
    await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/start-review`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(409);
    const adminMessage = await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/messages`)
      .set(auth(admin.body.accessToken))
      .send({ body: 'We have both sides; please send the handover photos by tomorrow.' })
      .expect(201);
    expect(adminMessage.body.messages.at(-1)).toMatchObject({
      authorRole: 'admin',
      authorName: 'Platform team',
    });
    const customerAfter = (
      await api()
        .get(`/api/v1/disputes/${dispute.id}`)
        .set(auth(customer.body.accessToken))
        .expect(200)
    ).body as Dispute;
    expect(customerAfter.messages.at(-1)?.authorName).toBe('Platform team');
    expect((await takeAllEmails(app)).map((m) => m.to).sort()).toEqual(
      [customer.email, provider.email].sort(),
    );

    // Resolution: refund recommended → nothing moves on the payment; both parties notified; thread closed.
    const [paymentBefore] = await handle.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/resolve`)
      .set(auth(admin.body.accessToken))
      .send({ resolutionCode: 'refund_recommended' })
      .expect(400);
    const resolved = await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/resolve`)
      .set(auth(admin.body.accessToken))
      .send({
        resolutionCode: 'refund_recommended',
        publicNote:
          'The provider will refund the deposit deduction; our team follows up on the advance.',
        internalNote: 'Follow up in /admin/payments.',
      })
      .expect(200);
    expect(resolved.body).toMatchObject({
      status: 'resolved',
      resolutionCode: 'refund_recommended',
      resolvedBy: admin.userId,
    });
    const [paymentAfter] = await handle.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    expect(paymentAfter).toEqual(paymentBefore);
    const customerFinal = (
      await api()
        .get(`/api/v1/disputes/${dispute.id}`)
        .set(auth(customer.body.accessToken))
        .expect(200)
    ).body as Dispute;
    expect(customerFinal).toMatchObject({
      status: 'resolved',
      resolutionCode: 'refund_recommended',
      canMessage: false,
    });
    expect(customerFinal.publicResolutionNote).toContain('refund the deposit deduction');
    expect(JSON.stringify(customerFinal)).not.toContain('Follow up in');
    expect(await feed(customer.userId, 'dispute.resolved')).toHaveLength(1);
    expect(await feed(provider.userId, 'dispute.resolved')).toHaveLength(1);
    await message(customer.body.accessToken, dispute.id, 'one more thing').expect(409);
    await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/resolve`)
      .set(auth(admin.body.accessToken))
      .send({ resolutionCode: 'no_action', publicNote: 'already decided' })
      .expect(409);
    expect((await auditOf(dispute.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'dispute.opened',
        'dispute.message_posted',
        'dispute.internal_note_updated',
        'dispute.review_started',
        'dispute.resolved',
      ]),
    );
    const adminBooking = await api()
      .get(`/api/v1/admin/bookings/${booking.id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(adminBooking.body.dispute).toEqual({ id: dispute.id, status: 'resolved' });
    // Messages are append-only at the database level.
    const [first] = await handle.db
      .select()
      .from(disputeMessages)
      .where(eq(disputeMessages.disputeId, dispute.id));
    await expect(
      handle.db
        .update(disputeMessages)
        .set({ body: 'edited' })
        .where(eq(disputeMessages.id, first?.id as string)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('append-only') }),
    });
  });

  it('rejects a dispute with a public note and notifies both sides', async () => {
    const booking = await completed();
    const dispute = (
      await open(provider.body.accessToken, booking.id, {
        reasonCode: 'damage_claim',
        description: 'Customer returned the vehicle with a cracked mirror and denies it.',
      }).expect(201)
    ).body as Dispute;
    const rejected = await api()
      .post(`/api/v1/admin/disputes/${dispute.id}/reject`)
      .set(auth(admin.body.accessToken))
      .send({
        publicNote: 'No evidence was provided within the agreed time; the claim is not upheld.',
      })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', resolutionCode: null });
    expect(await feed(customer.userId, 'dispute.rejected')).toHaveLength(1);
    expect(await feed(provider.userId, 'dispute.rejected')).toHaveLength(1);
    expect((await auditOf(dispute.id)).map((a) => a.action)).toContain('dispute.rejected');
  });
});
