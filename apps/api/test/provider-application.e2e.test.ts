import type { NestExpressApplication } from '@nestjs/platform-express';
import { ProviderApplicationSchema } from '@vrp/contracts';
import { runMigrations, users, type DatabaseHandle } from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, takeEmailFor } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  completeApplication,
  newVerifiedUser,
  saveDraft,
  seedReference,
  submitApplication,
  type ReferenceIds,
} from './utils/provider-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping provider application e2e tests');

const SCOPE = 'papp';
const nextEmail = emailFactory(SCOPE);

describe.skipIf(!url)('provider application (applicant side)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('lets a verified customer start a partial draft and read it back', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const created = await saveDraft(app, user.body.accessToken, {
      displayName: 'Sunil Rentals',
      providerType: 'individual',
    });
    expect(ProviderApplicationSchema.safeParse(created.body).success).toBe(true);
    expect(created.body).toMatchObject({
      status: 'draft',
      displayName: 'Sunil Rentals',
      canEdit: true,
      vehicleCategoryIds: [],
      serviceAreaPlaceIds: [],
    });

    const fetched = await request(app.getHttpServer())
      .get('/api/v1/providers/me/application')
      .set('Authorization', `Bearer ${user.body.accessToken}`)
      .expect(200);
    expect(fetched.body.id).toBe(created.body.id);

    // Updating the same draft does not create a second application.
    const updated = await saveDraft(app, user.body.accessToken, { contactName: 'Sunil Perera' });
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.contactName).toBe('Sunil Perera');
    expect(updated.body.displayName).toBe('Sunil Rentals');
  });

  it('validates reference data: inactive districts/categories and places outside the district', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const token = user.body.accessToken;

    const wrongDistrict = await saveDraft(app, token, { districtId: refs.inactiveDistrictId }, 400);
    expect(wrongDistrict.body.error.details[0].field).toBe('districtId');

    const outsideDistrict = await saveDraft(
      app,
      token,
      { districtId: refs.districtId, primaryPlaceId: refs.gallePlaceId },
      400,
    );
    expect(outsideDistrict.body.error.details[0]).toMatchObject({ field: 'primaryPlaceId' });

    const inactiveCategory = await saveDraft(
      app,
      token,
      { vehicleCategoryIds: [refs.inactiveCategoryId] },
      400,
    );
    expect(inactiveCategory.body.error.details[0].field).toBe('vehicleCategoryIds.0');

    const unknownPlace = await saveDraft(
      app,
      token,
      { serviceAreaPlaceIds: ['0192f0a0-0000-7000-8000-000000000999'] },
      400,
    );
    expect(unknownPlace.body.error.details[0].field).toBe('serviceAreaPlaceIds.0');

    await saveDraft(app, token, { districtId: refs.districtId, primaryPlaceId: refs.mirissaId });
  });

  it('rejects unsafe or malformed inputs', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const token = user.body.accessToken;
    for (const bad of [
      { websiteUrl: 'javascript:alert(1)' },
      { websiteUrl: 'ftp://files.example' },
      { phone: '0771234567' },
      { displayName: 'A' },
      { description: 'too short' },
      { yearsOperating: -1 },
      { applicantNotes: 'x'.repeat(1001) },
    ]) {
      const response = await saveDraft(app, token, bad, 400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses mass assignment of status, review fields and roles', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const token = user.body.accessToken;
    for (const forbidden of [
      { status: 'approved' },
      { reviewReason: 'looks fine' },
      { adminNotes: 'internal' },
      { approvedAt: new Date().toISOString() },
      { roles: ['provider'] },
      { userId: '0192f0a0-0000-7000-8000-000000000001' },
    ]) {
      const response = await saveDraft(app, token, forbidden, 400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a complete application plus the agreement to submit, then locks it', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    const token = user.body.accessToken;

    await saveDraft(app, token, { displayName: 'Sunil Rentals' });
    const incomplete = await submitApplication(app, token, 400);
    const missing = incomplete.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(missing).toEqual(
      [
        'addressText',
        'contactName',
        'description',
        'districtId',
        'phone',
        'primaryPlaceId',
        'providerType',
        'vehicleCategoryIds',
      ].sort(),
    );

    await saveDraft(app, token, completeApplication(refs));
    await request(app.getHttpServer())
      .post('/api/v1/providers/me/application/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ acceptProviderAgreement: false })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/providers/me/application/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    const submitted = await submitApplication(app, token);
    expect(submitted.body).toMatchObject({
      status: 'submitted',
      agreementVersion: '2026-10',
      canEdit: false,
      canSubmit: false,
    });
    expect(submitted.body.submittedAt).toBeTruthy();
    expect(submitted.body.agreementAcceptedAt).toBeTruthy();
    expect(await takeEmailFor(app, user.email, 'received')).toBeDefined();

    const locked = await saveDraft(app, token, { description: 'edited after submit?' }, 409);
    expect(locked.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const twice = await submitApplication(app, token, 409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('blocks submission when the account e-mail is no longer verified', async () => {
    const user = await newVerifiedUser(app, nextEmail());
    await saveDraft(app, user.body.accessToken, completeApplication(refs));
    await handle.db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, user.userId));

    const blocked = await submitApplication(app, user.body.accessToken, 403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('keeps applications private and provider-only routes closed before approval', async () => {
    const alice = await newVerifiedUser(app, nextEmail());
    const bob = await newVerifiedUser(app, nextEmail());
    await saveDraft(app, alice.body.accessToken, { displayName: 'Alice Cars' });

    const bobView = await request(app.getHttpServer())
      .get('/api/v1/providers/me/application')
      .set('Authorization', `Bearer ${bob.body.accessToken}`)
      .expect(404);
    expect(bobView.body.error.code).toBe('NOT_FOUND');

    await request(app.getHttpServer())
      .get('/api/v1/providers/me')
      .set('Authorization', `Bearer ${alice.body.accessToken}`)
      .expect(404);
    const providerAction = await request(app.getHttpServer())
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${alice.body.accessToken}`)
      .send({ description: 'Trying to edit a profile that does not exist yet, twenty chars.' })
      .expect(403);
    expect(providerAction.body.error.code).toBe('FORBIDDEN');

    await request(app.getHttpServer()).get('/api/v1/providers/me/application').expect(401);
  });
});
