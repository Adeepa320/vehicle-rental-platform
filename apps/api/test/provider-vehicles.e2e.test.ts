import type { NestExpressApplication } from '@nestjs/platform-express';
import { VehicleSchema } from '@vrp/contracts';
import { runMigrations } from '@vrp/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanupUsers, emailFactory, takeEmailFor } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  newAdmin,
  newVerifiedUser,
  seedReference,
  type ApplicantSession,
  type ReferenceIds,
} from './utils/provider-helpers';
import {
  adminVehicleAction,
  approvedProvider,
  approvedVehicle,
  completeVehicle,
  createVehicle,
  newLocation,
  patchVehicle,
  submitCompleteVehicle,
  vehicleAction,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping provider vehicles e2e tests');

const SCOPE = 'pveh';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('provider vehicles', () => {
  let app: NestExpressApplication;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let locationId: string;
  let plateCounter = 1000;
  const nextPlate = () => `CAB-${(plateCounter += 1)}`;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin);
    locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('creates a draft from the category alone and reports the submission checklist', async () => {
    const token = provider.body.accessToken;
    const created = await createVehicle(app, token, { categoryId: 'car' });
    expect(VehicleSchema.safeParse(created.body).success).toBe(true);
    expect(created.body).toMatchObject({
      status: 'draft',
      providerId: provider.providerId,
      editable: 'all',
      canSubmit: false,
      currency: 'LKR',
      hasAc: false,
      minRentalDays: 1,
    });
    const missing = created.body.submissionIssues.map((i: { field: string }) => i.field);
    for (const field of [
      'locationId',
      'title',
      'make',
      'registrationNumber',
      'dailyRate',
      'transmission',
      'doors',
    ]) {
      expect(missing).toContain(field);
    }
    const list = await request(app.getHttpServer())
      .get('/api/v1/providers/me/vehicles')
      .set(auth(token))
      .expect(200);
    expect(list.body.some((v: { id: string }) => v.id === created.body.id)).toBe(true);

    const updated = await patchVehicle(app, token, created.body.id, {
      registrationNumber: ' cab-9999 ',
      dailyRate: '7500',
    });
    expect(updated.body.registrationNumber).toBe('CAB-9999');
    expect(updated.body.dailyRate).toBe('7500.00');
  });

  it('validates references, category rules, money and plate uniqueness', async () => {
    const token = provider.body.accessToken;
    const badCategory = await createVehicle(app, token, { categoryId: 'hovercraft' }, 400);
    expect(badCategory.body.error.details[0].field).toBe('categoryId');
    const inactiveCategory = await createVehicle(
      app,
      token,
      { categoryId: refs.inactiveCategoryId },
      400,
    );
    expect(inactiveCategory.body.error.details[0].field).toBe('categoryId');
    const badLocation = await createVehicle(
      app,
      token,
      { categoryId: 'car', locationId: '0192f0a0-0000-7000-8000-000000000999' },
      400,
    );
    expect(badLocation.body.error.details[0].field).toBe('locationId');
    const bikeWithDoors = await createVehicle(app, token, { categoryId: 'bike', doors: 2 }, 400);
    expect(bikeWithDoors.body.error.details[0].field).toBe('doors');
    for (const dailyRate of ['-5', 'abc', '7500.123', '100', 1000]) {
      await createVehicle(app, token, { categoryId: 'car', dailyRate }, 400);
    }
    const weekly = await createVehicle(
      app,
      token,
      { categoryId: 'car', dailyRate: '7500', weeklyRate: '60000' },
      400,
    );
    expect(weekly.body.error.details[0].field).toBe('weeklyRate');

    // Cross-field check against the stored values, not only the patch.
    const draft = await createVehicle(app, token, { categoryId: 'car', dailyRate: '7500' });
    const inconsistent = await patchVehicle(
      app,
      token,
      draft.body.id,
      { weeklyRate: '60000' },
      400,
    );
    expect(inconsistent.body.error.details[0].field).toBe('weeklyRate');

    const plate = nextPlate();
    await createVehicle(app, token, { categoryId: 'car', registrationNumber: plate });
    const duplicate = await createVehicle(
      app,
      token,
      { categoryId: 'car', registrationNumber: plate },
      409,
    );
    expect(duplicate.body.error.details[0].field).toBe('registrationNumber');
    const other = await approvedProvider(app, nextEmail(), refs, admin, 'Other Fleet');
    await createVehicle(app, other.body.accessToken, {
      categoryId: 'car',
      registrationNumber: plate,
    });
  });

  it('refuses status, ownership and review fields from the client', async () => {
    const token = provider.body.accessToken;
    const draft = await createVehicle(app, token, { categoryId: 'car' });
    for (const injected of [
      { status: 'approved' },
      { providerId: '0192f0a0-0000-7000-8000-000000000001' },
      { adminNotes: 'mine now' },
      { reviewReason: 'none' },
      { approvedAt: new Date().toISOString() },
      { deletedAt: null },
    ]) {
      const response = await patchVehicle(app, token, draft.body.id, injected, 400);
      expect(response.body.error.code, JSON.stringify(injected)).toBe('VALIDATION_ERROR');
    }
    const fresh = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${draft.body.id}`)
      .set(auth(token))
      .expect(200);
    expect(fresh.body.status).toBe('draft');
  });

  it('keeps vehicles private to their provider and closed to customers', async () => {
    const mine = await createVehicle(app, provider.body.accessToken, {
      categoryId: 'car',
      title: 'Private car',
    });
    const other = await approvedProvider(app, nextEmail(), refs, admin, 'Nosy Rentals');
    const otherToken = other.body.accessToken;
    await request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${mine.body.id}`)
      .set(auth(otherToken))
      .expect(404);
    await patchVehicle(app, otherToken, mine.body.id, { title: 'Stolen' }, 404);
    await vehicleAction(app, otherToken, mine.body.id, 'submit', 404);

    const customer = await newVerifiedUser(app, nextEmail());
    const forbidden = await createVehicle(
      app,
      customer.body.accessToken,
      { categoryId: 'car' },
      403,
    );
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    await request(app.getHttpServer())
      .get('/api/v1/providers/me/vehicles')
      .set(auth(customer.body.accessToken))
      .expect(403);
  });

  it('submits only complete listings, then locks them and e-mails the provider', async () => {
    const token = provider.body.accessToken;
    const incomplete = await createVehicle(app, token, { categoryId: 'car', title: 'Half done' });
    const refused = await vehicleAction(app, token, incomplete.body.id, 'submit', 400);
    expect(refused.body.error.details.length).toBeGreaterThan(3);

    const vehicle = await submitCompleteVehicle(app, token, locationId, {
      registrationNumber: nextPlate(),
    });
    expect(vehicle).toMatchObject({ status: 'submitted', editable: 'none', canSubmit: false });
    expect(vehicle.submittedAt).toBeTruthy();
    await patchVehicle(app, token, vehicle.id, { title: 'Too late' }, 409);
    const again = await vehicleAction(app, token, vehicle.id, 'submit', 409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(
      await takeEmailFor(app, provider.email, 'We received your vehicle listing'),
    ).toBeDefined();
  });

  it('lets the provider correct and resubmit after changes are requested', async () => {
    const token = provider.body.accessToken;
    const vehicle = await submitCompleteVehicle(app, token, locationId, {
      registrationNumber: nextPlate(),
    });
    await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'request-changes', {
      reason: 'Please add the engine size and a clearer description.',
    });
    const view = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${vehicle.id}`)
      .set(auth(token))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'changes_requested', editable: 'all' });
    expect(view.body.reviewReason).toMatch(/engine size/);
    expect('adminNotes' in view.body).toBe(false);

    await patchVehicle(app, token, vehicle.id, { engineCc: 1500, make: 'Toyota' });
    const resubmitted = await vehicleAction(app, token, vehicle.id, 'submit');
    expect(resubmitted.body).toMatchObject({ status: 'submitted', reviewReason: null });
  });

  it('allows operational edits and deactivation after approval but locks identity fields', async () => {
    const token = provider.body.accessToken;
    const vehicle = await approvedVehicle(app, token, admin.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    expect(vehicle).toMatchObject({ status: 'approved', editable: 'operational' });

    const priced = await patchVehicle(app, token, vehicle.id, {
      dailyRate: '8000',
      weeklyRate: null,
      monthlyRate: null,
    });
    expect(priced.body.dailyRate).toBe('8000.00');
    const locked = await patchVehicle(
      app,
      token,
      vehicle.id,
      { make: 'Honda', dailyRate: '8500' },
      400,
    );
    expect(locked.body.error.details).toEqual([{ field: 'make', issue: 'locked after approval' }]);

    const inactive = await vehicleAction(app, token, vehicle.id, 'deactivate');
    expect(inactive.body).toMatchObject({ status: 'inactive', editable: 'operational' });
    expect(inactive.body.deactivatedAt).toBeTruthy();
    await vehicleAction(app, token, vehicle.id, 'deactivate', 409);
    const active = await vehicleAction(app, token, vehicle.id, 'activate');
    expect(active.body).toMatchObject({ status: 'approved', deactivatedAt: null });
    await vehicleAction(app, token, vehicle.id, 'submit', 409);
  });

  it('blocks a suspended provider from managing inventory', async () => {
    const suspended = await approvedProvider(app, nextEmail(), refs, admin, 'Paused Rentals');
    const token = suspended.body.accessToken;
    const vehicle = await createVehicle(
      app,
      token,
      completeVehicle(locationId, { registrationNumber: nextPlate() }),
      400,
    );
    // the location belongs to another provider → rejected; use their own
    expect(vehicle.body.error.details[0].field).toBe('locationId');
    const own = await newLocation(app, token, refs);
    const draft = await createVehicle(app, token, { categoryId: 'car', locationId: own.id });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${suspended.providerId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Smoke: policy breach.' })
      .expect(200);
    const blocked = await patchVehicle(app, token, draft.body.id, { title: 'Still mine?' }, 403);
    expect(blocked.body.error.code).toBe('PROVIDER_SUSPENDED');
    await createVehicle(app, token, { categoryId: 'car' }, 403);
    await request(app.getHttpServer())
      .get('/api/v1/providers/me/vehicles')
      .set(auth(token))
      .expect(403);
  });
});
