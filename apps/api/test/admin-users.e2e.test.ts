import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminUserDetailSchema,
  AdminUserListSchema,
  type AdminUserDetail,
  type Booking,
} from '@vrp/contracts';
import {
  auditEvents,
  bookingDrivers,
  bookings,
  providerApplications,
  providerProfiles,
  refreshTokens,
  reviews,
  runMigrations,
  users,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { grantRole } from '../src/cli/grant-admin.js';
import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, login, nextSecond, takeAllEmails } from './utils/auth-helpers';
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
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin user management e2e tests');

const SCOPE = 'ausr';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('admin user management (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let superAdmin: ApplicantSession;
  let provider: ProviderSession;
  let vehicleId: string;
  const nextWindow = windowAllocator(colomboMidnight, 20);

  const api = () => request(app.getHttpServer());
  const detail = async (id: string): Promise<AdminUserDetail> => {
    const res = await api()
      .get(`/api/v1/admin/users/${id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminUserDetailSchema.safeParse(res.body).success).toBe(true);
    return res.body as AdminUserDetail;
  };
  const auditRows = (targetId: string) =>
    handle.db
      .select({
        action: auditEvents.action,
        actorUserId: auditEvents.actorUserId,
        reason: auditEvents.reason,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'user'), eq(auditEvents.targetId, targetId)));
  const completedBooking = async (customer: ApplicantSession): Promise<Booking> => {
    const w = nextWindow(2);
    const b = await requestBooking(app, customer.body.accessToken, vehicleId, w.startsAt, w.endsAt);
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
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    superAdmin = await newAdmin(app, nextEmail());
    await grantRole(handle.db, superAdmin.email, 'super_admin');
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'User Ops Rentals');
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicleId = (
      await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
        registrationNumber: 'AU-1001',
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('keeps the user routes closed to anonymous callers, customers and providers', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    await api().get('/api/v1/admin/users').expect(401);
    const asCustomer = await api()
      .get('/api/v1/admin/users')
      .set(auth(customer.body.accessToken))
      .expect(403);
    expect(asCustomer.body.error.code).toBe('FORBIDDEN');
    await api().get('/api/v1/admin/users').set(auth(provider.body.accessToken)).expect(403);
    await api()
      .post(`/api/v1/admin/users/${customer.userId}/suspend`)
      .set(auth(provider.body.accessToken))
      .send({ reason: 'provider cannot do this' })
      .expect(403);
  });

  it('searches users by e-mail / name, status and role and returns a safe detail', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const list = await api()
      .get('/api/v1/admin/users')
      .query({ q: customer.email.slice(0, 20), limit: 10 })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminUserListSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.data.map((u: { id: string }) => u.id)).toContain(customer.userId);
    const providers = await api()
      .get('/api/v1/admin/users')
      .query({ role: 'provider', q: provider.email })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(providers.body.data[0]).toMatchObject({
      id: provider.userId,
      providerId: provider.providerId,
    });

    const d = await detail(customer.userId);
    expect(d).toMatchObject({
      id: customer.userId,
      email: customer.email,
      status: 'active',
      provider: null,
      anonymisation: { allowed: true, blockers: [] },
    });
    const json = JSON.stringify(d);
    for (const forbidden of [
      'passwordHash',
      'password_hash',
      'tokenHash',
      'sessionsRevokedAt',
      '$argon2',
    ]) {
      expect(json, `leaks ${forbidden}`).not.toContain(forbidden);
    }
    const [row] = await handle.db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, customer.userId));
    expect(json).not.toContain(row?.hash as string);
  });

  it('suspends with a reason (sessions revoked, audited, notified) and reactivates', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    await takeAllEmails(app);
    await nextSecond();
    const suspended = await api()
      .post(`/api/v1/admin/users/${customer.userId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Repeated no-shows reported by two providers' })
      .expect(200);
    expect(suspended.body).toMatchObject({
      status: 'suspended',
      suspensionReason: 'Repeated no-shows reported by two providers',
    });
    // The existing session is dead immediately, and the refresh token family is revoked.
    const blocked = await api()
      .get('/api/v1/users/me')
      .set(auth(customer.body.accessToken))
      .expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    const active = await handle.db
      .select({ id: refreshTokens.id, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, customer.userId));
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((t) => t.revokedAt !== null)).toBe(true);
    // Login is refused while suspended.
    const loginAttempt = await api()
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: customer.email, password: 'correct horse battery staple' });
    expect(loginAttempt.status).toBeGreaterThanOrEqual(400);
    const mails = await takeAllEmails(app);
    expect(mails.find((m) => m.to === customer.email)?.subject).toContain('suspended');
    expect(await auditRows(customer.userId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'user.suspended',
          actorUserId: admin.userId,
          reason: 'Repeated no-shows reported by two providers',
        }),
      ]),
    );
    // Reason is mandatory.
    const other = await newVerifiedUser(app, nextEmail());
    await api()
      .post(`/api/v1/admin/users/${other.userId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(400);

    const reactivated = await api()
      .post(`/api/v1/admin/users/${customer.userId}/reactivate`)
      .set(auth(admin.body.accessToken))
      .send({ note: 'Cleared after a call' })
      .expect(200);
    expect(reactivated.body).toMatchObject({ status: 'active', suspensionReason: null });
    const fresh = await login(app, customer.email);
    await api().get('/api/v1/users/me').set(auth(fresh.body.accessToken)).expect(200);
    expect((await auditRows(customer.userId)).map((r) => r.action)).toContain('user.reactivated');
  });

  it('lets only a super admin act on another admin and never on themselves', async () => {
    const target = await newAdmin(app, nextEmail());
    const refused = await api()
      .post(`/api/v1/admin/users/${target.userId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'ordinary admins cannot suspend admins' })
      .expect(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    await api()
      .post(`/api/v1/admin/users/${admin.userId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'self-suspension attempt' })
      .expect(409);
    await api()
      .post(`/api/v1/admin/users/${target.userId}/suspend`)
      .set(auth(superAdmin.body.accessToken))
      .send({ reason: 'super admin may suspend an admin' })
      .expect(200);
    await api()
      .post(`/api/v1/admin/users/${target.userId}/reactivate`)
      .set(auth(superAdmin.body.accessToken))
      .send({})
      .expect(200);
  });

  it('refuses anonymisation while a booking, a dispute or an unresolved refund is open', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const w = nextWindow(2);
    const booking = await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w.startsAt,
      w.endsAt,
    );
    const blocked = await api()
      .post(`/api/v1/admin/users/${customer.userId}/anonymise`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Deletion request by e-mail', confirmEmail: customer.email })
      .expect(409);
    expect(blocked.body.error.code).toBe('ACCOUNT_ANONYMISATION_BLOCKED');
    expect(blocked.body.error.details.map((d: { issue: string }) => d.issue)).toContain(
      'open_booking_as_customer',
    );
    expect((await detail(customer.userId)).anonymisation).toEqual({
      allowed: false,
      blockers: ['open_booking_as_customer'],
    });

    // Complete the booking, then open a dispute: still blocked.
    await providerBookingAction(
      app,
      provider.body.accessToken,
      booking.id,
      'accept',
      { version: 1 },
      200,
    );
    await payAdvance(app, customer.body.accessToken, booking.id);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      booking.id,
      'pickup',
      { version: 3 },
      200,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      booking.id,
      'return',
      { version: 4 },
      200,
    );
    await api()
      .post(`/api/v1/bookings/${booking.id}/dispute`)
      .set(auth(customer.body.accessToken))
      .send({
        reasonCode: 'vehicle_condition',
        description: 'The scooter had a flat tyre at pickup and no spare.',
      })
      .expect(201);
    expect((await detail(customer.userId)).anonymisation.blockers).toEqual(['open_dispute']);

    // A paid booking cancelled by the provider leaves a refund due: blocked until the refund is recorded.
    const other = await newVerifiedUser(app, nextEmail());
    const w2 = nextWindow(2);
    const paid = await requestBooking(
      app,
      other.body.accessToken,
      vehicleId,
      w2.startsAt,
      w2.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      paid.id,
      'accept',
      { version: 1 },
      200,
    );
    await payAdvance(app, other.body.accessToken, paid.id);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      paid.id,
      'cancel',
      { version: 3 },
      200,
    );
    const refundBlocked = await api()
      .post(`/api/v1/admin/users/${other.userId}/anonymise`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Deletion request', confirmEmail: other.email })
      .expect(409);
    expect(refundBlocked.body.error.details.map((d: { issue: string }) => d.issue)).toContain(
      'refund_due',
    );
  });

  it('anonymises an eligible account: PII gone, history kept, review shown as "Former customer", sessions revoked', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const booking = await completedBooking(customer);
    await api()
      .post(`/api/v1/bookings/${booking.id}/review`)
      .set(auth(customer.body.accessToken))
      .send({ overallRating: 4, comment: 'Smooth handover, clean car.' })
      .expect(201);
    const originalName = 'Nimal Perera';
    const originalEmail = customer.email;
    await takeAllEmails(app);

    // The confirmation must match the account e-mail.
    await api()
      .post(`/api/v1/admin/users/${customer.userId}/anonymise`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Deletion request', confirmEmail: 'someone-else@example.com' })
      .expect(400);

    await nextSecond();
    const result = await api()
      .post(`/api/v1/admin/users/${customer.userId}/anonymise`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Deletion request received on 2026-10-14', confirmEmail: originalEmail })
      .expect(200);
    expect(result.body).toMatchObject({ status: 'deleted', fullName: 'Deleted user', phone: null });
    expect(result.body.email).toBe(`deleted+${customer.userId}@anonymised.invalid`);
    expect(result.body.deletedAt).not.toBeNull();

    const [row] = await handle.db.select().from(users).where(eq(users.id, customer.userId));
    expect(row).toMatchObject({
      status: 'deleted',
      fullName: 'Deleted user',
      phoneE164: null,
      passwordHash: '!anonymised',
    });
    expect(row?.email).not.toContain(originalEmail);
    // History survives with the same foreign keys.
    const [kept] = await handle.db
      .select({ id: bookings.id, customerUserId: bookings.customerUserId })
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(kept).toEqual({ id: booking.id, customerUserId: customer.userId });
    const [driver] = await handle.db
      .select({ fullName: bookingDrivers.fullName })
      .from(bookingDrivers)
      .where(eq(bookingDrivers.bookingId, booking.id));
    expect(driver?.fullName).toBe('Former customer');
    const [review] = await handle.db
      .select({ id: reviews.id, comment: reviews.comment })
      .from(reviews)
      .where(eq(reviews.bookingId, booking.id));
    expect(review?.comment).toBe('Smooth handover, clean car.');
    // Public review shows a neutral name, never "Deleted U.".
    const publicReviews = await api().get(`/api/v1/vehicles/${vehicleId}/reviews`).expect(200);
    const shown = publicReviews.body.data.find((r: { id: string }) => r.id === review?.id);
    expect(shown.reviewer.displayName).toBe('Former customer');
    expect(JSON.stringify(publicReviews.body)).not.toContain(originalName);
    // Sessions are dead and the old credentials no longer work.
    await api().get('/api/v1/users/me').set(auth(customer.body.accessToken)).expect(401);
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: originalEmail, password: 'correct horse battery staple' })
      .expect(401);
    // Audited with actor, target and reason; a second attempt is blocked as already anonymised.
    expect(await auditRows(customer.userId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'user.anonymised',
          actorUserId: admin.userId,
          reason: 'Deletion request received on 2026-10-14',
        }),
      ]),
    );
    const again = await api()
      .post(`/api/v1/admin/users/${customer.userId}/anonymise`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'twice', confirmEmail: `deleted+${customer.userId}@anonymised.invalid` })
      .expect(409);
    expect(again.body.error.details.map((d: { issue: string }) => d.issue)).toContain(
      'already_anonymised',
    );
    const mails = await takeAllEmails(app);
    expect(mails.find((m) => m.to === originalEmail)?.subject).toContain('closed');
  });

  it('anonymising a provider owner suspends the profile and scrubs its contact fields', async () => {
    const owner = await approvedProvider(app, nextEmail(), refs, admin, 'Closing Rentals');
    const result = await api()
      .post(`/api/v1/admin/users/${owner.userId}/anonymise`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Provider closed the business', confirmEmail: owner.email })
      .expect(200);
    expect(result.body.provider).toMatchObject({ id: owner.providerId, status: 'suspended' });
    const [profile] = await handle.db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, owner.providerId));
    expect(profile).toMatchObject({
      status: 'suspended',
      contactName: 'Former provider',
      whatsappE164: null,
      suspensionReason: 'Owner account anonymised',
    });
    const [application] = await handle.db
      .select({
        phone: providerApplications.phoneE164,
        contactName: providerApplications.contactName,
      })
      .from(providerApplications)
      .where(eq(providerApplications.userId, owner.userId));
    expect(application).toEqual({ phone: null, contactName: 'Former applicant' });
    // Privileged accounts are never anonymised.
    const blocked = await api()
      .post(`/api/v1/admin/users/${superAdmin.userId}/anonymise`)
      .set(auth(superAdmin.body.accessToken))
      .send({ reason: 'x'.repeat(5), confirmEmail: superAdmin.email })
      .expect(409);
    expect(blocked.body.error.code).toBe('CONFLICT');
  });
});
