import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminPlaceSchema,
  AdminVehicleCategorySchema,
  type AdminPlace,
  type AdminVehicleCategory,
} from '@vrp/contracts';
import { auditEvents, runMigrations, type DatabaseHandle } from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { grantRole } from '../src/cli/grant-admin.js';
import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
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
  createLocation,
  locationPayload,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url)
  console.warn('DATABASE_URL_TEST is not set: skipping reference-data administration e2e tests');

const SCOPE = 'aref';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('reference-data administration (Phase 9, super admin)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let superAdmin: ApplicantSession;
  let provider: ProviderSession;
  const slug = `ahangama-test-${Math.random().toString(36).slice(2, 7)}`;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    superAdmin = await newAdmin(app, nextEmail());
    await grantRole(handle.db, superAdmin.email, 'super_admin');
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Reference Rentals');
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('separates reads (admin) from writes (super admin) and offers no delete routes', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    await api().get('/api/v1/admin/districts').set(auth(customer.body.accessToken)).expect(403);
    await api().get('/api/v1/admin/districts').set(auth(provider.body.accessToken)).expect(403);
    const districts = await api()
      .get('/api/v1/admin/districts')
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(districts.body.find((d: { id: string }) => d.id === 'matara')).toMatchObject({
      isActive: true,
      placeCount: expect.any(Number),
      providerCount: expect.any(Number),
    });
    const refused = await api()
      .patch('/api/v1/admin/districts/colombo')
      .set(auth(admin.body.accessToken))
      .send({ isActive: true })
      .expect(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    await api().post('/api/v1/admin/places').set(auth(admin.body.accessToken)).send({}).expect(403);
    await api()
      .patch('/api/v1/admin/vehicle-categories/car')
      .set(auth(admin.body.accessToken))
      .send({ name: 'Cars' })
      .expect(403);
    for (const path of [
      `/api/v1/admin/districts/matara`,
      `/api/v1/admin/places/${refs.mirissaId}`,
      `/api/v1/admin/vehicle-categories/car`,
    ]) {
      await api().delete(path).set(auth(superAdmin.body.accessToken)).expect(404);
    }
  });

  it('activates / deactivates districts with an audit trail and leaves history intact', async () => {
    // Start from a known state whatever an earlier run left behind (the flag is insert-only in the seed).
    const seeded = (
      await api().get('/api/v1/admin/districts').set(auth(admin.body.accessToken)).expect(200)
    ).body.find((d: { id: string }) => d.id === 'colombo') as { sortOrder: number };
    await api()
      .patch('/api/v1/admin/districts/colombo')
      .set(auth(superAdmin.body.accessToken))
      .send({ isActive: false, sortOrder: 10 })
      .expect(200);
    const on = await api()
      .patch('/api/v1/admin/districts/colombo')
      .set(auth(superAdmin.body.accessToken))
      .send({ isActive: true, sortOrder: 1 })
      .expect(200);
    expect(on.body).toMatchObject({ id: 'colombo', isActive: true, sortOrder: 1 });
    const publicList = (await api().get('/api/v1/reference/districts').expect(200)).body as {
      id: string;
      isActive: boolean;
    }[];
    expect(publicList.find((d) => d.id === 'colombo')?.isActive).toBe(true);
    await api()
      .patch('/api/v1/admin/districts/colombo')
      .set(auth(superAdmin.body.accessToken))
      .send({ isActive: false, sortOrder: seeded.sortOrder })
      .expect(200);
    await api()
      .patch('/api/v1/admin/districts/nowhere')
      .set(auth(superAdmin.body.accessToken))
      .send({ isActive: true })
      .expect(404);
    await api()
      .patch('/api/v1/admin/districts/colombo')
      .set(auth(superAdmin.body.accessToken))
      .send({})
      .expect(400);
    const rows = await handle.db
      .select({ metadata: auditEvents.metadata, actorUserId: auditEvents.actorUserId })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'district.updated'));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: superAdmin.userId,
          metadata: {
            districtId: 'colombo',
            before: { isActive: false, sortOrder: 10 },
            after: { isActive: true, sortOrder: 1 },
          },
        }),
      ]),
    );
    // The provider in Matara is untouched.
    const profile = await api()
      .get('/api/v1/providers/me')
      .set(auth(provider.body.accessToken))
      .expect(200);
    expect(profile.body.districtId).toBe('matara');
  });

  it('creates and edits places with validated coordinates and relations; inactive places leave suggestions and new locations', async () => {
    const base = {
      name: 'Ahangama (test)',
      kind: 'town',
      districtId: 'galle',
      centre: { lat: 5.9736, lng: 80.3625 },
      defaultRadiusKm: 10,
      isLaunchArea: true,
    };
    await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug, centre: { lat: 95, lng: 80 } })
      .expect(400);
    await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug, centre: { lat: 5.97, lng: 200 } })
      .expect(400);
    const badDistrict = await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug, districtId: 'atlantis' })
      .expect(400);
    expect(badDistrict.body.error.details[0].field).toBe('districtId');
    const badParent = await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug, parentId: refs.mirissaId })
      .expect(400); // Mirissa is in Matara, not Galle
    expect(badParent.body.error.details[0].field).toBe('parentId');
    await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug: 'Bad Slug!' })
      .expect(400);
    const created = await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug, parentId: refs.gallePlaceId })
      .expect(201);
    expect(AdminPlaceSchema.safeParse(created.body).success).toBe(true);
    const place = created.body as AdminPlace;
    expect(place).toMatchObject({
      slug,
      name: 'Ahangama (test)',
      districtId: 'galle',
      parentId: refs.gallePlaceId,
      isActive: true,
      locationCount: 0,
    });
    expect(place.centre.lat).toBeCloseTo(5.9736, 4);
    const duplicate = await api()
      .post('/api/v1/admin/places')
      .set(auth(superAdmin.body.accessToken))
      .send({ ...base, slug })
      .expect(409);
    expect(duplicate.body.error.details[0].field).toBe('slug');
    // Public suggest and provider locations see the new place.
    const suggest = (
      await api().get('/api/v1/places/suggest').query({ q: 'ahangama (test' }).expect(200)
    ).body as { id: string }[];
    expect(suggest.map((p) => p.id)).toContain(place.id);
    const located = await createLocation(
      app,
      provider.body.accessToken,
      locationPayload(refs, {
        name: 'Ahangama office',
        districtId: 'galle',
        placeId: place.id,
        point: { lat: 5.9736, lng: 80.3625 },
      }),
    );
    expect(located.body.placeId).toBe(place.id);
    // The public JSON of the place never carries a provider's pin: only the town centre.
    const publicPlaces = (
      await api().get('/api/v1/reference/places').query({ districtId: 'galle' }).expect(200)
    ).body as Record<string, unknown>[];
    expect(JSON.stringify(publicPlaces.find((p) => p.id === place.id))).not.toMatch(/lat|lng|geom/);
    // Edit, then deactivate: suggestions stop, new locations are refused, the existing location survives.
    const edited = await api()
      .patch(`/api/v1/admin/places/${place.id}`)
      .set(auth(superAdmin.body.accessToken))
      .send({
        name: 'Ahangama Beach (test)',
        aliases: ['ahangama beach'],
        centre: { lat: 5.974, lng: 80.363 },
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      name: 'Ahangama Beach (test)',
      aliases: ['ahangama beach'],
      locationCount: 1,
    });
    const off = await api()
      .patch(`/api/v1/admin/places/${place.id}`)
      .set(auth(superAdmin.body.accessToken))
      .send({ isActive: false })
      .expect(200);
    expect(off.body.isActive).toBe(false);
    expect(
      (
        (await api().get('/api/v1/places/suggest').query({ q: 'ahangama' }).expect(200)).body as {
          id: string;
        }[]
      ).map((p) => p.id),
    ).not.toContain(place.id);
    expect(
      (
        (await api().get('/api/v1/reference/places').query({ districtId: 'galle' }).expect(200))
          .body as { id: string }[]
      ).map((p) => p.id),
    ).not.toContain(place.id);
    const inactiveListed = (
      await api()
        .get('/api/v1/admin/places')
        .query({ includeInactive: 'true', q: 'ahangama' })
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body as AdminPlace[];
    expect(inactiveListed.map((p) => p.id)).toContain(place.id);
    await createLocation(
      app,
      provider.body.accessToken,
      locationPayload(refs, {
        name: 'Second Ahangama office',
        districtId: 'galle',
        placeId: place.id,
      }),
      400,
    );
    const mine = (
      await api()
        .get('/api/v1/providers/me/locations')
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body as { data?: { id: string }[] } | { id: string }[];
    const rows = Array.isArray(mine) ? mine : (mine.data ?? []);
    expect(rows.map((l) => l.id)).toContain(located.body.id as string);
    expect(
      (
        await handle.db
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.targetId, place.id))
      ).map((r) => r.action),
    ).toEqual(expect.arrayContaining(['place.created', 'place.updated']));
  });

  it('manages existing categories only and keeps scooter and tuk-tuk inactive', async () => {
    const all = (
      await api()
        .get('/api/v1/admin/vehicle-categories')
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body as AdminVehicleCategory[];
    expect(all.every((c) => AdminVehicleCategorySchema.safeParse(c).success)).toBe(true);
    for (const id of ['scooter', 'tuktuk']) {
      const row = all.find((c) => c.id === id);
      expect(row?.isActive).toBe(false);
      expect(row?.activationBlockedReason).toContain('decision');
      const refused = await api()
        .patch(`/api/v1/admin/vehicle-categories/${id}`)
        .set(auth(superAdmin.body.accessToken))
        .send({ isActive: true })
        .expect(409);
      expect(refused.body.error.code).toBe('CONFLICT');
    }
    const renamed = await api()
      .patch('/api/v1/admin/vehicle-categories/car')
      .set(auth(superAdmin.body.accessToken))
      .send({ name: 'Car (self-drive)', sortOrder: 1 })
      .expect(200);
    expect(renamed.body).toMatchObject({ id: 'car', name: 'Car (self-drive)', isActive: true });
    await api()
      .patch('/api/v1/admin/vehicle-categories/car')
      .set(auth(superAdmin.body.accessToken))
      .send({ name: 'Car' })
      .expect(200);
    await api()
      .post('/api/v1/admin/vehicle-categories')
      .set(auth(superAdmin.body.accessToken))
      .send({ id: 'hovercraft', name: 'Hovercraft' })
      .expect(404);
    await api()
      .patch('/api/v1/admin/vehicle-categories/hovercraft')
      .set(auth(superAdmin.body.accessToken))
      .send({ name: 'Hovercraft' })
      .expect(404);
    const publicCategories = (await api().get('/api/v1/reference/vehicle-categories').expect(200))
      .body as { id: string }[];
    expect(publicCategories.map((c) => c.id).sort()).toEqual(['bike', 'car', 'suv', 'van']);
    const rows = await handle.db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'vehicle_category.updated'));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            categoryId: 'car',
            after: { name: 'Car (self-drive)', sortOrder: 1 },
          }),
        }),
      ]),
    );
  });
});
