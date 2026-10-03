import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminProviderApplicationListSchema,
  AdminProviderApplicationSchema,
  AdminProviderListSchema,
  ProviderProfileSchema,
} from '@vrp/contracts';
import {
  auditEvents,
  providerApplications,
  providerProfiles,
  runMigrations,
  users,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, takeEmailFor } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  adminAction,
  newAdmin,
  newVerifiedUser,
  rolesOf,
  saveDraft,
  seedReference,
  submitApplication,
  submitCompleteApplication,
  type ApplicantSession,
  type ReferenceIds,
} from './utils/provider-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin provider review e2e tests');

const SCOPE = 'padmin';
const nextEmail = emailFactory(SCOPE);

describe.skipIf(!url)('admin provider review', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;

  const auditActions = async (targetType: string, targetId: string) => {
    const rows = await handle.db
      .select({ action: auditEvents.action, actorUserId: auditEvents.actorUserId })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, targetType), eq(auditEvents.targetId, targetId)));
    return rows;
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('keeps every admin endpoint closed to customers, providers and anonymous callers', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const application = await submitCompleteApplication(app, customer.body.accessToken, refs);

    await request(app.getHttpServer()).get('/api/v1/admin/provider-applications').expect(401);
    const listAsCustomer = await request(app.getHttpServer())
      .get('/api/v1/admin/provider-applications')
      .set('Authorization', `Bearer ${customer.body.accessToken}`)
      .expect(403);
    expect(listAsCustomer.body.error.code).toBe('FORBIDDEN');

    // The applicant cannot approve themselves.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/provider-applications/${application.id}/approve`)
      .set('Authorization', `Bearer ${customer.body.accessToken}`)
      .send({})
      .expect(403);
    expect(await rolesOf(app, customer.userId)).toEqual(['customer']);
  });

  it('lists, filters and inspects applications with applicant details', async () => {
    const applicant = await newVerifiedUser(app, nextEmail());
    const application = await submitCompleteApplication(app, applicant.body.accessToken, refs);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/provider-applications?status=submitted&limit=50')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(200);
    expect(AdminProviderApplicationListSchema.safeParse(list.body).success).toBe(true);
    const row = list.body.data.find((a: { id: string }) => a.id === application.id);
    expect(row).toMatchObject({ status: 'submitted', applicant: { email: applicant.email } });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/provider-applications/${application.id}`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(200);
    expect(AdminProviderApplicationSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body.applicant).toMatchObject({ email: applicant.email, emailVerified: true });
    expect(detail.body.adminNotes).toBeNull();

    await request(app.getHttpServer())
      .get('/api/v1/admin/provider-applications/not-a-uuid')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/provider-applications/0192f0a0-0000-7000-8000-000000000123')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(404);
  });

  it('runs the review loop: start review → request changes → applicant corrects → resubmits', async () => {
    const applicant = await newVerifiedUser(app, nextEmail());
    const application = await submitCompleteApplication(app, applicant.body.accessToken, refs);
    const token = admin.body.accessToken;

    const reviewing = await adminAction(app, token, application.id, 'start-review', {
      adminNotes: 'Calling the applicant tomorrow.',
    });
    expect(reviewing.body).toMatchObject({
      status: 'under_review',
      adminNotes: 'Calling the applicant tomorrow.',
    });
    expect(reviewing.body.reviewStartedAt).toBeTruthy();
    const again = await adminAction(app, token, application.id, 'start-review', {}, 409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');

    await adminAction(app, token, application.id, 'request-changes', { reason: 'no' }, 400);
    const changes = await adminAction(app, token, application.id, 'request-changes', {
      reason: 'Please add the exact pickup address and a landline number.',
    });
    expect(changes.body).toMatchObject({
      status: 'changes_requested',
      reviewReason: 'Please add the exact pickup address and a landline number.',
      reviewedBy: admin.userId,
    });
    expect(await takeEmailFor(app, applicant.email, 'Action needed')).toBeDefined();

    const applicantView = await request(app.getHttpServer())
      .get('/api/v1/providers/me/application')
      .set('Authorization', `Bearer ${applicant.body.accessToken}`)
      .expect(200);
    expect(applicantView.body).toMatchObject({ status: 'changes_requested', canEdit: true });
    expect(applicantView.body.reviewReason).toMatch(/pickup address/);
    expect('adminNotes' in applicantView.body).toBe(false);

    await saveDraft(app, applicant.body.accessToken, {
      addressText: '12 Beach Road, next to the fish market, Mirissa 81740',
    });
    const resubmitted = await submitApplication(app, applicant.body.accessToken);
    expect(resubmitted.body).toMatchObject({ status: 'submitted', reviewReason: null });

    const actions = (await auditActions('provider_application', application.id)).map(
      (e) => e.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'provider_application.submitted',
        'provider_application.review_started',
        'provider_application.changes_requested',
      ]),
    );
    expect(actions.filter((a) => a === 'provider_application.submitted')).toHaveLength(2);
  });

  it('approves atomically: application approved, profile created, provider role appended, audited, e-mailed', async () => {
    const applicant = await newVerifiedUser(app, nextEmail());
    const application = await submitCompleteApplication(app, applicant.body.accessToken, refs);
    // Unrelated roles must survive approval.
    await handle.db
      .update(users)
      .set({ roles: ['customer', 'super_admin'] })
      .where(eq(users.id, applicant.userId));

    const approved = await adminAction(app, admin.body.accessToken, application.id, 'approve', {
      adminNotes: 'Phone call confirmed the business operates from Mirissa.',
    });
    expect(approved.body).toMatchObject({ status: 'approved', reviewedBy: admin.userId });
    expect(approved.body.approvedAt).toBeTruthy();

    expect(await rolesOf(app, applicant.userId)).toEqual(['customer', 'super_admin', 'provider']);

    // Same access token: roles are read from the row, so the profile is reachable immediately.
    const profile = await request(app.getHttpServer())
      .get('/api/v1/providers/me')
      .set('Authorization', `Bearer ${applicant.body.accessToken}`)
      .expect(200);
    expect(ProviderProfileSchema.safeParse(profile.body).success).toBe(true);
    expect(profile.body).toMatchObject({
      displayName: 'Sunil Rentals Mirissa',
      status: 'active',
      phoneVerified: false,
      primaryPlaceId: refs.mirissaId,
      serviceAreaPlaceIds: [refs.weligamaId],
      vehicleCategoryIds: [refs.activeCategoryId],
    });
    expect(profile.body.slug).toMatch(/^sunil-rentals-mirissa-[a-z0-9]{4}$/);

    const [row] = await handle.db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, applicant.userId));
    expect(row?.approvedBy).toBe(admin.userId);
    expect(row?.applicationId).toBe(application.id);

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${applicant.body.accessToken}`)
      .expect(200);
    expect(me.body.roles).toContain('provider');

    expect(await takeEmailFor(app, applicant.email, 'approved')).toBeDefined();
    const audit = await auditActions('provider_application', application.id);
    const approvedEvent = audit.find((e) => e.action === 'provider_application.approved');
    expect(approvedEvent?.actorUserId).toBe(admin.userId);

    // Repeated or conflicting decisions are rejected and change nothing.
    const twice = await adminAction(
      app,
      admin.body.accessToken,
      application.id,
      'approve',
      {},
      409,
    );
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await adminAction(
      app,
      admin.body.accessToken,
      application.id,
      'reject',
      { reason: 'too late to reject' },
      409,
    );
    expect(await rolesOf(app, applicant.userId)).toEqual(['customer', 'super_admin', 'provider']);
  });

  it('rolls back an approval whose data no longer satisfies the submission rules', async () => {
    const applicant = await newVerifiedUser(app, nextEmail());
    await saveDraft(app, applicant.body.accessToken, { displayName: 'Half Done Rentals' });
    const [draft] = await handle.db
      .select({ id: providerApplications.id })
      .from(providerApplications)
      .where(eq(providerApplications.userId, applicant.userId));
    // Force an incomplete draft into `submitted` directly in the database.
    await handle.db
      .update(providerApplications)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(eq(providerApplications.id, draft?.id as string));

    const response = await adminAction(
      app,
      admin.body.accessToken,
      draft?.id as string,
      'approve',
      {},
      400,
    );
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    const [after] = await handle.db
      .select({ status: providerApplications.status })
      .from(providerApplications)
      .where(eq(providerApplications.id, draft?.id as string));
    expect(after?.status).toBe('submitted');
    expect(await rolesOf(app, applicant.userId)).toEqual(['customer']);
    expect(
      await handle.db
        .select()
        .from(providerProfiles)
        .where(eq(providerProfiles.userId, applicant.userId)),
    ).toHaveLength(0);
  });

  it('rejects terminally without granting anything', async () => {
    const applicant = await newVerifiedUser(app, nextEmail());
    const application = await submitCompleteApplication(app, applicant.body.accessToken, refs);

    const rejected = await adminAction(app, admin.body.accessToken, application.id, 'reject', {
      reason: 'We could not verify that the business operates in the launch area.',
    });
    expect(rejected.body).toMatchObject({ status: 'rejected' });
    expect(rejected.body.rejectedAt).toBeTruthy();
    expect(await rolesOf(app, applicant.userId)).toEqual(['customer']);
    expect(
      await takeEmailFor(app, applicant.email, 'Update on your provider application'),
    ).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/v1/providers/me')
      .set('Authorization', `Bearer ${applicant.body.accessToken}`)
      .expect(404);
    await saveDraft(
      app,
      applicant.body.accessToken,
      { description: 'trying to reopen after reject' },
      409,
    );
    await submitApplication(app, applicant.body.accessToken, 409);
    await adminAction(app, admin.body.accessToken, application.id, 'approve', {}, 409);
  });

  it('suspends and reactivates providers; suspension blocks provider actions but not reading', async () => {
    const applicant = await newVerifiedUser(app, nextEmail());
    const application = await submitCompleteApplication(app, applicant.body.accessToken, refs);
    await adminAction(app, admin.body.accessToken, application.id, 'approve');
    const token = applicant.body.accessToken;

    const profile = await request(app.getHttpServer())
      .get('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const providerId = profile.body.id as string;

    // Active providers can edit contact fields; status and identity fields are off limits.
    await request(app.getHttpServer())
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ whatsapp: '+94770000001', offersAirportTransfer: true })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
      .expect(400);

    // A provider is not an admin.
    await request(app.getHttpServer())
      .get('/api/v1/admin/providers')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const suspended = await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${providerId}/suspend`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ reason: 'Repeated no-shows reported by customers.' })
      .expect(200);
    expect(suspended.body).toMatchObject({
      status: 'suspended',
      suspensionReason: 'Repeated no-shows reported by customers.',
    });
    expect(await takeEmailFor(app, applicant.email, 'suspended')).toBeDefined();

    const stillReadable = await request(app.getHttpServer())
      .get('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(stillReadable.body.status).toBe('suspended');
    const blocked = await request(app.getHttpServer())
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Trying to edit while suspended, which must fail.' })
      .expect(403);
    expect(blocked.body.error.code).toBe('PROVIDER_SUSPENDED');
    expect(await rolesOf(app, applicant.userId)).toContain('provider');

    await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${providerId}/suspend`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ reason: 'Suspending twice should not be possible.' })
      .expect(409);

    const reactivated = await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${providerId}/reactivate`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ note: 'Issue resolved with the provider by phone.' })
      .expect(200);
    expect(reactivated.body).toMatchObject({
      status: 'active',
      suspendedAt: null,
      suspensionReason: null,
    });
    expect(await takeEmailFor(app, applicant.email, 'active again')).toBeDefined();
    await request(app.getHttpServer())
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Back in business after the suspension was lifted.' })
      .expect(200);

    const actions = (await auditActions('provider_profile', providerId)).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'provider_profile.updated',
        'provider_profile.suspended',
        'provider_profile.reactivated',
      ]),
    );

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/providers?limit=1')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(200);
    expect(AdminProviderListSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.data).toHaveLength(1);
    if (list.body.nextCursor) {
      const next = await request(app.getHttpServer())
        .get(`/api/v1/admin/providers?limit=1&cursor=${encodeURIComponent(list.body.nextCursor)}`)
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .expect(200);
      expect(next.body.data[0]?.id).not.toBe(list.body.data[0]?.id);
    }
    await request(app.getHttpServer())
      .get('/api/v1/admin/providers?cursor=%%%')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(400);
  });
});
