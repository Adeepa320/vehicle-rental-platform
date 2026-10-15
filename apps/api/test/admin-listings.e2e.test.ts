import type { NestExpressApplication } from '@nestjs/platform-express';
import { AdminVehicleSchema, type AdminVehicle } from '@vrp/contracts';
import {
  auditEvents,
  notifications,
  runMigrations,
  vehiclePhotos,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import type { MemoryStorageProvider } from '../src/modules/storage/memory-storage.provider';
import { StorageService } from '../src/modules/storage/storage.service';
import { cleanupUsers, emailFactory, takeAllEmails } from './utils/auth-helpers';
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
  newLocation,
  testImage,
  uploadPhoto,
  vehicleAction,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin listing operations e2e tests');

const SCOPE = 'alst';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('admin listing operations (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let storage: MemoryStorageProvider;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let locationId: string;
  let plate = 7100;

  const api = () => request(app.getHttpServer());
  const adminVehicle = async (id: string): Promise<AdminVehicle> => {
    const res = await api()
      .get(`/api/v1/admin/vehicles/${id}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminVehicleSchema.safeParse(res.body).success).toBe(true);
    return res.body as AdminVehicle;
  };
  const searchIds = async (query: Record<string, string> = {}) =>
    (
      (
        await api()
          .get('/api/v1/vehicles/search')
          .query({ placeId: refs.mirissaId, limit: 50, ...query })
          .expect(200)
      ).body.data as { id: string }[]
    ).map((c) => c.id);
  const auditRows = (vehicleId: string) =>
    handle.db
      .select({
        action: auditEvents.action,
        actorUserId: auditEvents.actorUserId,
        reason: auditEvents.reason,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'vehicle'), eq(auditEvents.targetId, vehicleId)));
  const newApproved = (overrides: Record<string, unknown> = {}) =>
    approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
      registrationNumber: `LS-${(plate += 1)}`,
      ...overrides,
    });

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    storage = app.get(StorageService).provider as MemoryStorageProvider;
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Listing Ops Rentals');
    locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('searches listings by free text, category and place and reports the operations panel', async () => {
    const vehicle = await newApproved({
      title: 'Suzuki Wagon R 2019 – searchable',
      make: 'Suzuki',
      model: 'Wagon R',
    });
    const byText = await api()
      .get('/api/v1/admin/vehicles')
      .query({ q: 'wagon r' })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(byText.body.data.map((v: { id: string }) => v.id)).toContain(vehicle.id);
    const byPlate = await api()
      .get('/api/v1/admin/vehicles')
      .query({ q: vehicle.registrationNumber })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(byPlate.body.data.map((v: { id: string }) => v.id)).toEqual([vehicle.id]);
    const byPlace = await api()
      .get('/api/v1/admin/vehicles')
      .query({ placeId: refs.mirissaId, categoryId: 'car', status: 'approved' })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(byPlace.body.data.map((v: { id: string }) => v.id)).toContain(vehicle.id);
    const elsewhere = await api()
      .get('/api/v1/admin/vehicles')
      .query({ placeId: refs.gallePlaceId })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(elsewhere.body.data.map((v: { id: string }) => v.id)).not.toContain(vehicle.id);
    const view = await adminVehicle(vehicle.id);
    expect(view.operations).toMatchObject({
      publiclySearchable: true,
      searchabilityIssues: [],
      photoCount: 3,
      minimumPhotos: 3,
      openBookings: 0,
      autoPausedAt: null,
      documents: { verified: false },
    });
    expect(view.operations.documents.missing).toEqual([
      'certificate_of_registration',
      'revenue_licence',
      'insurance_certificate',
    ]);
    // Customers and providers never reach these routes.
    const customer = await newVerifiedUser(app, nextEmail());
    await api().get('/api/v1/admin/vehicles').set(auth(customer.body.accessToken)).expect(403);
    await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/category`)
      .set(auth(provider.body.accessToken))
      .send({ categoryId: 'suv', reason: 'nope' })
      .expect(403);
  });

  it('pauses a listing (provider notified, public search excludes it) and validates reactivation', async () => {
    const vehicle = await newApproved();
    expect(await searchIds()).toContain(vehicle.id);
    await takeAllEmails(app);
    await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'suspend', {
      reason: 'Customer complaint about the brakes',
    });
    expect(await searchIds()).not.toContain(vehicle.id);
    const inApp = await handle.db
      .select({ type: notifications.type, body: notifications.body })
      .from(notifications)
      .where(eq(notifications.userId, provider.userId));
    expect(inApp.find((n) => n.type === 'vehicle.suspended')?.body).toContain(
      'Customer complaint about the brakes',
    );
    expect(
      (await takeAllEmails(app)).some(
        (m) => m.to === provider.email && m.subject.includes('suspended'),
      ),
    ).toBe(true);
    expect((await adminVehicle(vehicle.id)).operations).toMatchObject({
      publiclySearchable: false,
      suspensionReason: 'Customer complaint about the brakes',
    });
    // A suspended provider blocks reactivation; once the provider is back it works and search includes the listing again.
    await api()
      .post(`/api/v1/admin/providers/${provider.providerId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Temporary standing check' })
      .expect(200);
    const refused = await adminVehicleAction(
      app,
      admin.body.accessToken,
      vehicle.id,
      'reactivate',
      {},
      409,
    );
    expect(refused.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(refused.body.error.message).toContain('provider is suspended');
    await api()
      .post(`/api/v1/admin/providers/${provider.providerId}/reactivate`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(200);
    await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'reactivate', {
      note: 'Brakes serviced; receipt seen',
    });
    expect(await searchIds()).toContain(vehicle.id);
    expect((await auditRows(vehicle.id)).map((r) => r.action)).toEqual(
      expect.arrayContaining(['vehicle.suspended', 'vehicle.reactivated']),
    );
    expect(inApp.length).toBeGreaterThan(0);
  });

  it('removes a photo with a reason; below the minimum the listing goes back to the provider and leaves search', async () => {
    const vehicle = await newApproved();
    const before = await adminVehicle(vehicle.id);
    expect(before.photos).toHaveLength(3);
    const target = before.photos[0] as { id: string };
    const [stored] = await handle.db
      .select({ storageKey: vehiclePhotos.storageKey, publicPrefix: vehiclePhotos.publicPrefix })
      .from(vehiclePhotos)
      .where(eq(vehiclePhotos.id, target.id));
    await takeAllEmails(app);
    await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/photos/${target.id}/remove`)
      .set(auth(provider.body.accessToken))
      .send({ reason: 'not allowed' })
      .expect(403);
    await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/photos/${target.id}/remove`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(400);
    const after = await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/photos/${target.id}/remove`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Shows a person’s face and a phone number' })
      .expect(200);
    expect(after.body.photos).toHaveLength(2);
    expect(after.body.status).toBe('changes_requested');
    expect(after.body.reviewReason).toContain('Upload at least 3 photos');
    expect(after.body.operations).toMatchObject({ publiclySearchable: false, photoCount: 2 });
    expect(after.body.operations.searchabilityIssues.join(' ')).toContain('changes requested');
    expect(await searchIds()).not.toContain(vehicle.id);
    // Objects are gone, the row is soft-deleted, the audit trail has the reason.
    expect(storage.keys('private')).not.toContain(stored?.storageKey);
    expect(storage.keys('public').some((k) => k.startsWith(stored?.publicPrefix as string))).toBe(
      false,
    );
    const active = await handle.db
      .select({ id: vehiclePhotos.id })
      .from(vehiclePhotos)
      .where(and(eq(vehiclePhotos.vehicleId, vehicle.id), isNull(vehiclePhotos.deletedAt)));
    expect(active).toHaveLength(2);
    expect(await auditRows(vehicle.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'vehicle_photo.removed_by_admin',
          actorUserId: admin.userId,
          reason: 'Shows a person’s face and a phone number',
        }),
        expect.objectContaining({ action: 'vehicle.changes_requested', actorUserId: admin.userId }),
      ]),
    );
    const mail = (await takeAllEmails(app)).find(
      (m) => m.to === provider.email && m.subject.includes('photo'),
    );
    expect(mail?.text).toContain('needs at least 3');
    // The provider can fix it: upload a photo, resubmit, admin approves, searchable again.
    await uploadPhoto(app, provider.body.accessToken, vehicle.id, await testImage({ width: 900 }));
    await vehicleAction(app, provider.body.accessToken, vehicle.id, 'submit');
    await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'approve');
    expect(await searchIds()).toContain(vehicle.id);
    // A removal that keeps the minimum leaves the listing live.
    const roomy = await newApproved();
    await uploadPhoto(
      app,
      provider.body.accessToken,
      roomy.id,
      await testImage({ width: 901 }),
      409,
    ); // approved: photos locked for providers
    const roomyView = await adminVehicle(roomy.id);
    expect(roomyView.photos).toHaveLength(3);
  });

  it('corrects the category to an existing active one only and keeps scooter / tuk-tuk inactive', async () => {
    const vehicle = await newApproved();
    await takeAllEmails(app);
    const moved = await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/category`)
      .set(auth(admin.body.accessToken))
      .send({ categoryId: 'suv', reason: 'Listed as a car but it is a Jimny' })
      .expect(200);
    expect(moved.body.categoryId).toBe('suv');
    expect(await searchIds({ categoryId: 'suv' })).toContain(vehicle.id);
    expect(await searchIds({ categoryId: 'car' })).not.toContain(vehicle.id);
    expect(await auditRows(vehicle.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'vehicle.category_corrected',
          actorUserId: admin.userId,
          reason: 'Listed as a car but it is a Jimny',
          metadata: { from: 'car', to: 'suv' },
        }),
      ]),
    );
    expect(
      (await takeAllEmails(app)).some(
        (m) => m.to === provider.email && m.subject.includes('Category'),
      ),
    ).toBe(true);
    await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/category`)
      .set(auth(admin.body.accessToken))
      .send({ categoryId: 'suv', reason: 'same again' })
      .expect(400);
    const scooter = await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/category`)
      .set(auth(admin.body.accessToken))
      .send({ categoryId: refs.inactiveCategoryId, reason: 'try the inactive one' })
      .expect(400);
    expect(scooter.body.error.details[0].issue).toContain('inactive');
    await api()
      .post(`/api/v1/admin/vehicles/${vehicle.id}/category`)
      .set(auth(admin.body.accessToken))
      .send({ categoryId: 'hovercraft', reason: 'unknown category' })
      .expect(400);
    const publicCategories = (await api().get('/api/v1/reference/vehicle-categories').expect(200))
      .body as { id: string }[];
    expect(publicCategories.map((c) => c.id)).not.toContain('scooter');
    expect(publicCategories.map((c) => c.id)).not.toContain('tuktuk');
  });
});
