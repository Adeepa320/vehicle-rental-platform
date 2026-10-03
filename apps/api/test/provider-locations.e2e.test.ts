import type { NestExpressApplication } from '@nestjs/platform-express';
import { ProviderLocationSchema } from '@vrp/contracts';
import { runMigrations } from '@vrp/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  createVehicle,
  locationPayload,
  newLocation,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping provider locations e2e tests');

const SCOPE = 'ploc';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('provider pickup locations', () => {
  let app: NestExpressApplication;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('lets an active provider create locations; the first becomes primary and primary can be moved', async () => {
    const token = provider.body.accessToken;
    const first = await createLocation(app, token, locationPayload(refs));
    expect(ProviderLocationSchema.safeParse(first.body).success).toBe(true);
    expect(first.body).toMatchObject({
      providerId: provider.providerId,
      isPrimary: true,
      isActive: true,
      vehicleCount: 0,
      point: { lat: 5.9485, lng: 80.4718 },
    });

    const second = await createLocation(
      app,
      token,
      locationPayload(refs, { name: 'Weligama desk', placeId: refs.weligamaId, point: null }),
    );
    expect(second.body.isPrimary).toBe(false);
    expect(second.body.point).toBeNull();

    const moved = await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/locations/${second.body.id}`)
      .set(auth(token))
      .send({ isPrimary: true })
      .expect(200);
    expect(moved.body.isPrimary).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/api/v1/providers/me/locations')
      .set(auth(token))
      .expect(200);
    const byId = new Map(
      list.body.map((l: { id: string; isPrimary: boolean }) => [l.id, l.isPrimary]),
    );
    expect(byId.get(first.body.id)).toBe(false);
    expect(byId.get(second.body.id)).toBe(true);

    const unset = await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/locations/${second.body.id}`)
      .set(auth(token))
      .send({ isPrimary: false })
      .expect(400);
    expect(unset.body.error.details[0].field).toBe('isPrimary');
  });

  it('refuses customers, non-providers and suspended providers', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    const asCustomer = await createLocation(
      app,
      customer.body.accessToken,
      locationPayload(refs),
      403,
    );
    expect(asCustomer.body.error.code).toBe('FORBIDDEN');
    await request(app.getHttpServer()).get('/api/v1/providers/me/locations').expect(401);

    const suspended = await approvedProvider(app, nextEmail(), refs, admin, 'Suspended Rentals');
    await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${suspended.providerId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Smoke: repeated complaints.' })
      .expect(200);
    const blocked = await createLocation(
      app,
      suspended.body.accessToken,
      locationPayload(refs),
      403,
    );
    expect(blocked.body.error.code).toBe('PROVIDER_SUSPENDED');
    await request(app.getHttpServer())
      .get('/api/v1/providers/me/locations')
      .set(auth(suspended.body.accessToken))
      .expect(403);
  });

  it('validates district, place and coordinates and rejects mass assignment', async () => {
    const token = provider.body.accessToken;
    const inactiveDistrict = await createLocation(
      app,
      token,
      locationPayload(refs, { districtId: refs.inactiveDistrictId }),
      400,
    );
    expect(inactiveDistrict.body.error.details.map((d: { field: string }) => d.field)).toContain(
      'districtId',
    );
    const outside = await createLocation(
      app,
      token,
      locationPayload(refs, { placeId: refs.gallePlaceId }),
      400,
    );
    expect(outside.body.error.details[0]).toMatchObject({ field: 'placeId' });
    const abroad = await createLocation(
      app,
      token,
      locationPayload(refs, { point: { lat: 51.5, lng: -0.1 } }),
      400,
    );
    expect(abroad.body.error.code).toBe('VALIDATION_ERROR');
    const injected = await createLocation(
      app,
      token,
      locationPayload(refs, { providerId: '0192f0a0-0000-7000-8000-000000000001' }),
      400,
    );
    expect(injected.body.error.code).toBe('VALIDATION_ERROR');
    await createLocation(
      app,
      token,
      locationPayload(refs, { pickupInstructions: '<script>alert(1)</script>' }),
    );
  });

  it('hides other providers’ locations (404 on read, update and deactivate)', async () => {
    const other = await approvedProvider(app, nextEmail(), refs, admin, 'Other Rentals');
    const mine = await newLocation(app, provider.body.accessToken, refs, {
      name: 'Private office',
    });
    const otherToken = other.body.accessToken;
    await request(app.getHttpServer())
      .get(`/api/v1/providers/me/locations/${mine.id}`)
      .set(auth(otherToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/locations/${mine.id}`)
      .set(auth(otherToken))
      .send({ name: 'Hijacked' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/locations/${mine.id}`)
      .set(auth(otherToken))
      .expect(404);
    const stillMine = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/locations/${mine.id}`)
      .set(auth(provider.body.accessToken))
      .expect(200);
    expect(stillMine.body.name).toBe('Private office');
  });

  it('deactivates instead of deleting, refuses while vehicles use the location, and can reactivate', async () => {
    const token = provider.body.accessToken;
    const location = await newLocation(app, token, refs, { name: 'Temporary desk' });
    const vehicle = await createVehicle(app, token, { categoryId: 'car', locationId: location.id });

    const inUse = await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/locations/${location.id}`)
      .set(auth(token))
      .expect(409);
    expect(inUse.body.error.code).toBe('LOCATION_IN_USE');

    const withCount = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/locations/${location.id}`)
      .set(auth(token))
      .expect(200);
    expect(withCount.body.vehicleCount).toBe(1);

    // Move the vehicle elsewhere, then deactivation succeeds and is reversible.
    const elsewhere = await newLocation(app, token, refs, { name: 'Elsewhere' });
    await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/vehicles/${vehicle.body.id}`)
      .set(auth(token))
      .send({ locationId: elsewhere.id })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/locations/${location.id}`)
      .set(auth(token))
      .expect(204);
    const inactive = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/locations/${location.id}`)
      .set(auth(token))
      .expect(200);
    expect(inactive.body).toMatchObject({ isActive: false, isPrimary: false });

    // An inactive location cannot be used for a vehicle or made primary.
    const rejected = await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/vehicles/${vehicle.body.id}`)
      .set(auth(token))
      .send({ locationId: location.id })
      .expect(400);
    expect(rejected.body.error.details[0].field).toBe('locationId');
    await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/locations/${location.id}`)
      .set(auth(token))
      .send({ isPrimary: true })
      .expect(400);

    const reactivated = await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/locations/${location.id}`)
      .set(auth(token))
      .send({ isActive: true })
      .expect(200);
    expect(reactivated.body.isActive).toBe(true);
  });
});
