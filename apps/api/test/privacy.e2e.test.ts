import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminPrivacyRequestListSchema,
  AdminPrivacyRequestSchema,
  PrivacyRequestListSchema,
  PrivacyRequestSchema,
  UserDataExportSchema,
  type AdminPrivacyRequest,
  type PrivacyRequest,
  type UserDataExport,
} from '@vrp/contracts';
import { auditEvents, notifications, runMigrations, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, findEmail, takeAllEmails } from './utils/auth-helpers';
import { providerBookingAction, requestBooking, windowAllocator } from './utils/booking-helpers';
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
  colomboMidnight,
  newLocation,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping privacy e2e tests');

const SCOPE = 'priv';
const nextEmail = emailFactory(SCOPE);
const OPS = 'ops-privacy@example.com';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SENSITIVE =
  /passwordHash|password_hash|tokenHash|secretCiphertext|md5sig|storageKey|documents\/|internalNote|merchantSecret/;

describe.skipIf(!url)(
  'privacy: personal-data export, deletion requests and the operator queue (Phase 10)',
  () => {
    let app: NestExpressApplication;
    let handle: DatabaseHandle;
    let refs: ReferenceIds;
    let admin: ApplicantSession;
    let provider: ProviderSession;
    let customer: ApplicantSession;
    let other: ApplicantSession;
    let vehicleId: string;
    let bookingId: string;
    let deletionRequestId = '';
    const nextWindow = windowAllocator(colomboMidnight, 120);
    const api = () => request(app.getHttpServer());
    const audits = (targetId: string, action: string) =>
      handle.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.targetId, targetId), eq(auditEvents.action, action)));

    beforeAll(async () => {
      await runMigrations(url as string);
      app = await createTestApp({
        DATABASE_URL: url as string,
        OPERATOR_NOTIFICATION_EMAIL: OPS,
      });
      handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
      refs = await seedReference(app);
      admin = await newAdmin(app, nextEmail());
      provider = await approvedProvider(app, nextEmail(), refs, admin, 'Privacy Rentals');
      customer = await newVerifiedUser(app, nextEmail());
      other = await newVerifiedUser(app, nextEmail());
      const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
      vehicleId = (
        await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
          registrationNumber: 'PV-7001',
        })
      ).id;
      const w = nextWindow(2);
      bookingId = (
        await requestBooking(app, customer.body.accessToken, vehicleId, w.startsAt, w.endsAt)
      ).id;
      await takeAllEmails(app);
    });

    afterAll(async () => {
      await cleanupUsers(app, SCOPE);
      await app.close();
    });

    it('exports an allow-listed JSON document as a download and audits it', async () => {
      const res = await api()
        .get('/api/v1/users/me/export')
        .set(auth(customer.body.accessToken))
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(UserDataExportSchema.safeParse(res.body).success).toBe(true);
      const data = res.body as UserDataExport;
      expect(data.subject.userId).toBe(customer.userId);
      expect(data.account.email).toBe(customer.email);
      expect(data.bookings).toHaveLength(1);
      expect(data.bookings[0]).toMatchObject({
        role: 'customer',
        status: 'requested',
        counterparty: 'Privacy Rentals',
      });
      expect(data.bookings[0]?.driver?.fullName).toBeDefined();
      expect(data.provider).toBeNull();
      expect(data.sessions.active).toBeGreaterThanOrEqual(1);
      expect(data.truncated).toEqual([]);
      expect(JSON.stringify(res.body)).not.toMatch(SENSITIVE);
      expect(JSON.stringify(res.body)).not.toContain(provider.email);
      expect(await audits(customer.userId, 'user.data_exported')).toHaveLength(1);

      // The provider's export lists the booking from the other side with only the customer's display name.
      const theirs = await api()
        .get('/api/v1/users/me/export')
        .set(auth(provider.body.accessToken))
        .expect(200);
      const providerData = theirs.body as UserDataExport;
      expect(providerData.provider?.displayName).toBe('Privacy Rentals');
      expect(providerData.provider?.vehicles[0]?.registrationNumber).toBe('PV-7001');
      expect(providerData.bookings[0]).toMatchObject({
        role: 'provider',
        driver: null,
        customerNote: null,
      });
      expect(JSON.stringify(theirs.body)).not.toContain(customer.email);
    });

    it('records a deletion request with the current blockers, notifies both sides and refuses a duplicate', async () => {
      const wrong = await api()
        .post('/api/v1/users/me/delete-request')
        .set(auth(customer.body.accessToken))
        .send({ confirmEmail: other.email })
        .expect(400);
      expect(wrong.body.error.details[0].field).toBe('confirmEmail');

      const created = await api()
        .post('/api/v1/users/me/delete-request')
        .set(auth(customer.body.accessToken))
        .send({ confirmEmail: customer.email.toUpperCase(), note: 'Please remove my account' })
        .expect(202);
      expect(PrivacyRequestSchema.safeParse(created.body).success).toBe(true);
      const req = created.body as PrivacyRequest;
      deletionRequestId = req.id;
      expect(req).toMatchObject({ type: 'deletion', status: 'open', publicNote: null });
      expect(req.blockers).toContain('open_booking_as_customer');
      expect(JSON.stringify(created.body)).not.toContain('Please remove');

      const duplicate = await api()
        .post('/api/v1/users/me/delete-request')
        .set(auth(customer.body.accessToken))
        .send({ confirmEmail: customer.email })
        .expect(409);
      expect(duplicate.body.error.code).toBe('PRIVACY_REQUEST_ALREADY_OPEN');

      const list = await api()
        .get('/api/v1/users/me/privacy-requests')
        .set(auth(customer.body.accessToken))
        .expect(200);
      expect(PrivacyRequestListSchema.safeParse(list.body).success).toBe(true);
      expect(list.body.data).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toMatch(/internalNote|requesterNote|handledBy/);

      const inApp = await handle.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, customer.userId),
            eq(notifications.type, 'privacy.request_received'),
          ),
        );
      expect(inApp).toHaveLength(1);
      expect(inApp[0]?.linkPath).toBe('/account/privacy');
      const mails = await takeAllEmails(app);
      expect(findEmail(mails, customer.email, 'account deletion request')).toBeDefined();
      const ops = findEmail(mails, OPS, '[Ops] New deletion request');
      expect(ops?.text).toContain(`/admin/privacy-requests/${req.id}`);
      expect(ops?.text).not.toContain(customer.email);
      expect(await audits(req.id, 'privacy_request.created')).toHaveLength(1);
    });

    it('lets operators review, note, and is blocked from completing while blockers exist', async () => {
      await api()
        .get('/api/v1/admin/privacy-requests')
        .set(auth(customer.body.accessToken))
        .expect(403);
      await api()
        .get('/api/v1/admin/privacy-requests')
        .set(auth(provider.body.accessToken))
        .expect(403);

      const list = await api()
        .get('/api/v1/admin/privacy-requests')
        .query({ status: 'open', type: 'deletion' })
        .set(auth(admin.body.accessToken))
        .expect(200);
      expect(AdminPrivacyRequestListSchema.safeParse(list.body).success).toBe(true);
      const mine = (list.body.data as AdminPrivacyRequest[]).find(
        (r) => r.id === deletionRequestId,
      );
      expect(mine).toMatchObject({
        source: 'self',
        requesterNote: 'Please remove my account',
        user: { id: customer.userId, email: customer.email },
      });

      const review = await api()
        .post(`/api/v1/admin/privacy-requests/${deletionRequestId}/start-review`)
        .set(auth(admin.body.accessToken))
        .expect(200);
      expect(review.body).toMatchObject({ status: 'in_review', handledBy: { id: admin.userId } });
      expect(review.body.acknowledgedAt).not.toBeNull();
      await api()
        .post(`/api/v1/admin/privacy-requests/${deletionRequestId}/start-review`)
        .set(auth(admin.body.accessToken))
        .expect(409);

      const noted = await api()
        .put(`/api/v1/admin/privacy-requests/${deletionRequestId}/internal-note`)
        .set(auth(admin.body.accessToken))
        .send({ note: 'Identity confirmed by reply e-mail' })
        .expect(200);
      expect(noted.body.internalNote).toBe('Identity confirmed by reply e-mail');
      const own = await api()
        .get('/api/v1/users/me/privacy-requests')
        .set(auth(customer.body.accessToken))
        .expect(200);
      expect(JSON.stringify(own.body)).not.toContain('Identity confirmed');

      const blocked = await api()
        .post(`/api/v1/admin/privacy-requests/${deletionRequestId}/complete-deletion`)
        .set(auth(admin.body.accessToken))
        .send({ reason: 'Deletion request', confirmEmail: customer.email })
        .expect(409);
      expect(blocked.body.error.code).toBe('ACCOUNT_ANONYMISATION_BLOCKED');
      await api()
        .post(`/api/v1/admin/privacy-requests/${deletionRequestId}/complete-access`)
        .set(auth(admin.body.accessToken))
        .send({ publicNote: 'Wrong action for this type' })
        .expect(409);
    });

    it('completes the deletion through the Phase 9 anonymisation once the blocker is gone', async () => {
      await providerBookingAction(
        app,
        provider.body.accessToken,
        bookingId,
        'decline',
        { version: 1, reason: 'other', note: 'Not available' },
        200,
      );
      await takeAllEmails(app);
      const wrongEmail = await api()
        .post(`/api/v1/admin/privacy-requests/${deletionRequestId}/complete-deletion`)
        .set(auth(admin.body.accessToken))
        .send({ reason: 'Deletion request', confirmEmail: other.email })
        .expect(400);
      expect(wrongEmail.body.error.details[0].field).toBe('confirmEmail');

      const done = await api()
        .post(`/api/v1/admin/privacy-requests/${deletionRequestId}/complete-deletion`)
        .set(auth(admin.body.accessToken))
        .send({
          reason: 'Deletion request',
          confirmEmail: customer.email,
          publicNote: 'Your account was anonymised.',
        })
        .expect(200);
      expect(AdminPrivacyRequestSchema.safeParse(done.body).success).toBe(true);
      expect(done.body).toMatchObject({ status: 'completed', blockers: [] });
      expect(done.body.completedAt).not.toBeNull();
      expect(done.body.user.status).toBe('deleted');
      const user = await api()
        .get(`/api/v1/admin/users/${customer.userId}`)
        .set(auth(admin.body.accessToken))
        .expect(200);
      expect(user.body.status).toBe('deleted');
      expect(await audits(customer.userId, 'user.anonymised')).toHaveLength(1);
      expect(await audits(deletionRequestId, 'privacy_request.completed')).toHaveLength(1);
      // The anonymised account can no longer use its session.
      await api().get('/api/v1/users/me').set(auth(customer.body.accessToken)).expect(401);
    });

    it('records an access request on a user’s behalf, exports for it (audited) and completes it; rejections notify', async () => {
      const created = await api()
        .post('/api/v1/admin/privacy-requests')
        .set(auth(admin.body.accessToken))
        .send({ userId: other.userId, type: 'access', requesterNote: 'Asked by e-mail' })
        .expect(201);
      const access = created.body as AdminPrivacyRequest;
      expect(access).toMatchObject({ type: 'access', status: 'open', source: 'admin' });
      const exported = await api()
        .get(`/api/v1/admin/privacy-requests/${access.id}/export`)
        .set(auth(admin.body.accessToken))
        .expect(200);
      expect(exported.headers['content-disposition']).toContain(
        `privacy-request-${access.id}-export.json`,
      );
      expect(exported.body.subject.userId).toBe(other.userId);
      expect(await audits(access.id, 'privacy_request.export_generated')).toHaveLength(1);
      const completed = await api()
        .post(`/api/v1/admin/privacy-requests/${access.id}/complete-access`)
        .set(auth(admin.body.accessToken))
        .send({ publicNote: 'The export was sent to your e-mail address.' })
        .expect(200);
      expect(completed.body.status).toBe('completed');
      await takeAllEmails(app);

      const deletion = await api()
        .post('/api/v1/users/me/delete-request')
        .set(auth(other.body.accessToken))
        .send({ confirmEmail: other.email })
        .expect(202);
      const rejected = await api()
        .post(`/api/v1/admin/privacy-requests/${deletion.body.id}/reject`)
        .set(auth(admin.body.accessToken))
        .send({ publicNote: 'Please settle the open support case first.' })
        .expect(200);
      expect(rejected.body).toMatchObject({ status: 'rejected' });
      expect(rejected.body.rejectedAt).not.toBeNull();
      const mails = await takeAllEmails(app);
      expect(findEmail(mails, other.email, 'About your account deletion request')?.text).toContain(
        'Please settle the open support case first.',
      );
      const own = await api()
        .get('/api/v1/users/me/privacy-requests')
        .set(auth(other.body.accessToken))
        .expect(200);
      const mine = (own.body.data as PrivacyRequest[]).find((r) => r.id === deletion.body.id);
      expect(mine).toMatchObject({
        status: 'rejected',
        publicNote: 'Please settle the open support case first.',
      });
      // A rejected request no longer blocks a new one.
      await api()
        .post('/api/v1/users/me/delete-request')
        .set(auth(other.body.accessToken))
        .send({ confirmEmail: other.email })
        .expect(202);
    });

    it('documents the privacy routes in OpenAPI', async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/users/me/export',
          '/api/v1/users/me/delete-request',
          '/api/v1/users/me/privacy-requests',
          '/api/v1/admin/privacy-requests',
          '/api/v1/admin/privacy-requests/{id}/complete-deletion',
          '/api/v1/admin/system/worker',
        ]),
      );
    });
  },
);
