import type { NestExpressApplication } from '@nestjs/platform-express';
import { AdminVehicleListSchema, AdminVehicleSchema } from '@vrp/contracts';
import { auditEvents, runMigrations, vehicles, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
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
  createVehicle,
  newLocation,
  patchVehicle,
  submitCompleteVehicle,
  vehicleAction,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin vehicle review e2e tests');

const SCOPE = 'padv';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('admin vehicle review', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let locationId: string;
  let plateCounter = 2000;
  const nextPlate = () => `KY-${(plateCounter += 1)}`;

  const auditActions = async (vehicleId: string) =>
    (
      await handle.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(and(eq(auditEvents.targetType, 'vehicle'), eq(auditEvents.targetId, vehicleId)))
    ).map((e) => e.action);

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin);
    locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('keeps vehicle review closed to customers, providers and anonymous callers', async () => {
    const vehicle = await submitCompleteVehicle(app, provider.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    await request(app.getHttpServer()).get('/api/v1/admin/vehicles').expect(401);
    const customer = await newVerifiedUser(app, nextEmail());
    const asCustomer = await request(app.getHttpServer())
      .get('/api/v1/admin/vehicles')
      .set(auth(customer.body.accessToken))
      .expect(403);
    expect(asCustomer.body.error.code).toBe('FORBIDDEN');
    // The owner cannot approve their own listing.
    await adminVehicleAction(app, provider.body.accessToken, vehicle.id, 'approve', {}, 403);
    const still = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${vehicle.id}`)
      .set(auth(provider.body.accessToken))
      .expect(200);
    expect(still.body.status).toBe('submitted');
  });

  it('lists, filters, paginates and inspects listings with provider, owner and location', async () => {
    const token = admin.body.accessToken;
    const vehicle = await submitCompleteVehicle(app, provider.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/vehicles?status=submitted&limit=50')
      .set(auth(token))
      .expect(200);
    expect(AdminVehicleListSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.data.find((v: { id: string }) => v.id === vehicle.id)).toMatchObject({
      status: 'submitted',
      provider: { id: provider.providerId },
    });

    const page = await request(app.getHttpServer())
      .get(`/api/v1/admin/vehicles?providerId=${provider.providerId}&limit=1`)
      .set(auth(token))
      .expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.nextCursor).toBeTruthy();
    const next = await request(app.getHttpServer())
      .get(
        `/api/v1/admin/vehicles?providerId=${provider.providerId}&limit=1&cursor=${page.body.nextCursor}`,
      )
      .set(auth(token))
      .expect(200);
    expect(next.body.data[0].id).not.toBe(page.body.data[0].id);
    await request(app.getHttpServer())
      .get('/api/v1/admin/vehicles?cursor=garbage')
      .set(auth(token))
      .expect(400);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/vehicles/${vehicle.id}`)
      .set(auth(token))
      .expect(200);
    expect(AdminVehicleSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body).toMatchObject({
      adminNotes: null,
      registrationNumber: vehicle.registrationNumber,
      provider: { id: provider.providerId, owner: { email: provider.email } },
      location: { id: locationId, isActive: true },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/vehicles/0192f0a0-0000-7000-8000-000000000123')
      .set(auth(token))
      .expect(404);
  });

  it('runs the review loop and audits every decision', async () => {
    const token = admin.body.accessToken;
    const vehicle = await submitCompleteVehicle(app, provider.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    const reviewing = await adminVehicleAction(app, token, vehicle.id, 'start-review', {
      adminNotes: 'Checking the plate with the owner.',
    });
    expect(reviewing.body).toMatchObject({
      status: 'under_review',
      adminNotes: 'Checking the plate with the owner.',
    });
    await adminVehicleAction(app, token, vehicle.id, 'start-review', {}, 409);
    await adminVehicleAction(app, token, vehicle.id, 'request-changes', { reason: 'no' }, 400);
    const changes = await adminVehicleAction(app, token, vehicle.id, 'request-changes', {
      reason: 'Please add the real engine size and the colour.',
    });
    expect(changes.body).toMatchObject({ status: 'changes_requested', reviewedBy: admin.userId });
    expect(
      await takeEmailFor(app, provider.email, 'Action needed on your vehicle listing'),
    ).toBeDefined();

    await patchVehicle(app, provider.body.accessToken, vehicle.id, { color: 'Silver' });
    await vehicleAction(app, provider.body.accessToken, vehicle.id, 'submit');
    const approved = await adminVehicleAction(app, token, vehicle.id, 'approve', {
      adminNotes: 'Verified by phone.',
    });
    expect(approved.body).toMatchObject({ status: 'approved', reviewReason: null });
    expect(approved.body.approvedAt).toBeTruthy();
    const twice = await adminVehicleAction(app, token, vehicle.id, 'approve', {}, 409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await takeEmailFor(app, provider.email, 'is approved on')).toBeDefined();

    const actions = await auditActions(vehicle.id);
    expect(actions).toEqual(
      expect.arrayContaining([
        'vehicle.created',
        'vehicle.submitted',
        'vehicle.review_started',
        'vehicle.changes_requested',
        'vehicle.updated',
        'vehicle.approved',
      ]),
    );
    expect(actions.filter((a) => a === 'vehicle.submitted')).toHaveLength(2);
  });

  it('rolls back an approval whose data no longer satisfies the submission rules', async () => {
    const vehicle = await submitCompleteVehicle(app, provider.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    await handle.db.update(vehicles).set({ dailyRate: null }).where(eq(vehicles.id, vehicle.id));
    const refused = await adminVehicleAction(
      app,
      admin.body.accessToken,
      vehicle.id,
      'approve',
      {},
      400,
    );
    expect(refused.body.error.details.map((d: { field: string }) => d.field)).toContain(
      'dailyRate',
    );
    const [row] = await handle.db
      .select({ status: vehicles.status, approvedAt: vehicles.approvedAt })
      .from(vehicles)
      .where(eq(vehicles.id, vehicle.id));
    expect(row).toMatchObject({ status: 'submitted', approvedAt: null });
    expect(await auditActions(vehicle.id)).not.toContain('vehicle.approved');
  });

  it('rejects terminally and e-mails the reason', async () => {
    const vehicle = await submitCompleteVehicle(app, provider.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    const rejected = await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'reject', {
      reason: 'The registration number does not match the make and model.',
    });
    expect(rejected.body.status).toBe('rejected');
    await patchVehicle(app, provider.body.accessToken, vehicle.id, { title: 'Again' }, 409);
    await vehicleAction(app, provider.body.accessToken, vehicle.id, 'submit', 409);
    await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'approve', {}, 409);
    expect(await takeEmailFor(app, provider.email, 'Update on your vehicle listing')).toBeDefined();
  });

  it('suspends and reactivates listings; suspension freezes provider actions', async () => {
    const token = admin.body.accessToken;
    const vehicle = await approvedVehicle(app, provider.body.accessToken, token, locationId, {
      registrationNumber: nextPlate(),
    });
    const suspended = await adminVehicleAction(app, token, vehicle.id, 'suspend', {
      reason: 'Insurance lapsed.',
    });
    expect(suspended.body).toMatchObject({
      status: 'suspended',
      suspensionReason: 'Insurance lapsed.',
    });
    await patchVehicle(app, provider.body.accessToken, vehicle.id, { dailyRate: '9000' }, 409);
    await vehicleAction(app, provider.body.accessToken, vehicle.id, 'activate', 409);
    expect(await takeEmailFor(app, provider.email, 'has been suspended')).toBeDefined();

    const active = await adminVehicleAction(app, token, vehicle.id, 'reactivate', {
      note: 'Insurance renewed.',
    });
    expect(active.body).toMatchObject({
      status: 'approved',
      suspensionReason: null,
      suspendedAt: null,
    });
    expect(await takeEmailFor(app, provider.email, 'is active again')).toBeDefined();

    // Inactive listings can be suspended too; drafts cannot.
    await vehicleAction(app, provider.body.accessToken, vehicle.id, 'deactivate');
    await adminVehicleAction(app, token, vehicle.id, 'suspend', { reason: 'Second strike.' });
    const draft = await createVehicle(app, provider.body.accessToken, { categoryId: 'car' });
    await adminVehicleAction(
      app,
      token,
      draft.body.id,
      'suspend',
      { reason: 'Not possible.' },
      409,
    );

    expect(await auditActions(vehicle.id)).toEqual(
      expect.arrayContaining(['vehicle.suspended', 'vehicle.reactivated', 'vehicle.deactivated']),
    );
  });
});
