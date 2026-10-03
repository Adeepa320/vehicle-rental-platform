import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  PublicVehicleDetailSchema,
  VehicleSearchResponseSchema,
  type PublicVehicleCard,
} from '@vrp/contracts';
import {
  providerLocations,
  runMigrations,
  vehiclePhotos,
  type DatabaseHandle,
} from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  newAdmin,
  seedReference,
  type ApplicantSession,
  type ReferenceIds,
} from './utils/provider-helpers';
import {
  adminVehicleAction,
  approvedProvider,
  approvedVehicle,
  blockRequest,
  colomboMidnight,
  createVehicle,
  newLocation,
  submitCompleteVehicle,
  vehicleAction,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping public search e2e tests');

const SCOPE = 'pdisc';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const PRIVATE_STRINGS = [
  'addressText',
  'pickupInstructions',
  'pickupNotes',
  'registrationNumber',
  'internalName',
  'adminNotes',
  'reviewReason',
  'phone',
  'whatsapp',
  'email',
  '12 Beach Road',
  'Blue gate',
  '+94771234567',
  '5.9485',
  '80.4718',
];

describe.skipIf(!url)('public discovery (search, detail, privacy)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let providerA: ProviderSession;
  let providerB: ProviderSession;
  let locationA: string;
  const ids: Record<string, string> = {};
  const slugs: Record<string, string> = {};
  let plateCounter = 7000;
  const nextPlate = () => `PX-${(plateCounter += 1)}`;

  const search = (query: Record<string, string | number> = {}, expected = 200) =>
    request(app.getHttpServer()).get('/api/v1/vehicles/search').query(query).expect(expected);
  const idsOf = (body: { data: PublicVehicleCard[] }) => body.data.map((c) => c.id);

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    const adminToken = admin.body.accessToken;

    // Provider A in Mirissa with a pin.
    providerA = await approvedProvider(app, nextEmail(), refs, admin, 'Mirissa Motors');
    const tokenA = providerA.body.accessToken;
    locationA = (await newLocation(app, tokenA, refs, { name: 'Mirissa office' })).id;
    const a1 = await approvedVehicle(app, tokenA, adminToken, locationA, {
      registrationNumber: nextPlate(),
      title: 'Toyota Aqua 2018 – automatic hybrid',
      dailyRate: '7500',
      weeklyRate: '45000',
      monthlyRate: '150000',
    });
    ids.a1 = a1.id;
    slugs.a1 = a1.slug as string;
    const a2 = await approvedVehicle(app, tokenA, adminToken, locationA, {
      registrationNumber: nextPlate(),
      categoryId: 'bike',
      title: 'Honda CB 125 scrambler',
      make: 'Honda',
      model: 'CB125',
      transmission: 'manual',
      fuelType: 'petrol',
      seats: 2,
      doors: null,
      hasAc: false,
      engineCc: 125,
      dailyRate: '2500',
      weeklyRate: null,
      monthlyRate: null,
      deliveryAvailable: false,
      deliveryFee: null,
      minRentalDays: 2,
    });
    ids.a2 = a2.id;
    ids.a3 = (await createVehicle(app, tokenA, { categoryId: 'car', title: 'Draft only' })).body.id;
    ids.a4 = (
      await submitCompleteVehicle(app, tokenA, locationA, { registrationNumber: nextPlate() })
    ).id;
    const a5 = await submitCompleteVehicle(app, tokenA, locationA, {
      registrationNumber: nextPlate(),
    });
    await adminVehicleAction(app, adminToken, a5.id, 'reject', { reason: 'Plate does not match.' });
    ids.a5 = a5.id;
    const a6 = await approvedVehicle(app, tokenA, adminToken, locationA, {
      registrationNumber: nextPlate(),
    });
    await adminVehicleAction(app, adminToken, a6.id, 'suspend', { reason: 'Insurance lapsed.' });
    ids.a6 = a6.id;
    const a7 = await approvedVehicle(app, tokenA, adminToken, locationA, {
      registrationNumber: nextPlate(),
    });
    // Approved but one photo soft-deleted afterwards: below the public minimum.
    const [photo] = await handle.db
      .select({ id: vehiclePhotos.id })
      .from(vehiclePhotos)
      .where(eq(vehiclePhotos.vehicleId, a7.id))
      .limit(1);
    await handle.db
      .update(vehiclePhotos)
      .set({ deletedAt: new Date() })
      .where(eq(vehiclePhotos.id, photo!.id));
    ids.a7 = a7.id;
    const a8 = await approvedVehicle(app, tokenA, adminToken, locationA, {
      registrationNumber: nextPlate(),
    });
    await vehicleAction(app, tokenA, a8.id, 'deactivate');
    ids.a8 = a8.id;
    // Manual block on A1: days +10..+13.
    await blockRequest(app, tokenA, a1.id, {
      startsAt: colomboMidnight(10),
      endsAt: colomboMidnight(13),
      reason: 'maintenance',
    });

    // Provider B in Weligama without a pin.
    providerB = await approvedProvider(app, nextEmail(), refs, admin, 'Weligama Vans');
    const tokenB = providerB.body.accessToken;
    const locationB = (
      await newLocation(app, tokenB, refs, {
        name: 'Weligama yard',
        placeId: refs.weligamaId,
        point: null,
      })
    ).id;
    const b1 = await approvedVehicle(app, tokenB, adminToken, locationB, {
      registrationNumber: nextPlate(),
      categoryId: 'van',
      title: 'Toyota KDH van',
      model: 'KDH',
      seats: 8,
      doors: 4,
      dailyRate: '12000',
      weeklyRate: null,
      monthlyRate: null,
      deliveryAvailable: false,
      deliveryFee: null,
    });
    ids.b1 = b1.id;

    // Provider C: approved vehicle, then the provider is suspended.
    const providerC = await approvedProvider(app, nextEmail(), refs, admin, 'Suspended Cars');
    const locationC = (await newLocation(app, providerC.body.accessToken, refs)).id;
    ids.c1 = (
      await approvedVehicle(app, providerC.body.accessToken, adminToken, locationC, {
        registrationNumber: nextPlate(),
      })
    ).id;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${providerC.providerId}/suspend`)
      .set(auth(adminToken))
      .send({ reason: 'Smoke: complaints.' })
      .expect(200);

    // Provider D: approved vehicle whose location is deactivated in the database.
    const providerD = await approvedProvider(app, nextEmail(), refs, admin, 'Closed Office');
    const locationD = (await newLocation(app, providerD.body.accessToken, refs)).id;
    ids.d1 = (
      await approvedVehicle(app, providerD.body.accessToken, adminToken, locationD, {
        registrationNumber: nextPlate(),
      })
    ).id;
    await handle.db
      .update(providerLocations)
      .set({ isActive: false })
      .where(eq(providerLocations.id, locationD));
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('lists only approved, photographed listings of active providers at active locations', async () => {
    const response = await search({ limit: 50 });
    expect(VehicleSearchResponseSchema.safeParse(response.body).success).toBe(true);
    const found = idsOf(response.body);
    expect(found).toEqual(expect.arrayContaining([ids.a1, ids.a2, ids.b1]));
    for (const hidden of ['a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'c1', 'd1']) {
      expect(found, hidden).not.toContain(ids[hidden]);
    }
    for (const hidden of ['a3', 'a6', 'a7', 'a8', 'c1', 'd1']) {
      await request(app.getHttpServer()).get(`/api/v1/vehicles/${ids[hidden]}`).expect(404);
    }
    const card = response.body.data.find(
      (c: PublicVehicleCard) => c.id === ids.a1,
    ) as PublicVehicleCard;
    expect(card).toMatchObject({
      slug: slugs.a1,
      provider: { displayName: 'Mirissa Motors', platformApproved: true },
      place: { slug: 'mirissa', districtId: 'matara' },
      approxPoint: { lat: 5.95, lng: 80.47, source: 'approximate' },
      pricing: { currency: 'LKR', dailyRate: '7500.00', securityDeposit: '25000.00' },
      estimate: null,
      distanceKm: null,
    });
    expect(card.photo?.variants.thumb).toMatch(/\/thumb\.webp$/);
  });

  it('filters by category, district, place radius, price, transmission, fuel, seats, AC and delivery', async () => {
    expect(idsOf((await search({ categoryId: 'car', limit: 50 })).body)).toEqual(
      expect.not.arrayContaining([ids.a2, ids.b1]),
    );
    expect(idsOf((await search({ categoryId: 'van', limit: 50 })).body)).toEqual([ids.b1]);
    expect(idsOf((await search({ districtId: 'matara', limit: 50 })).body)).toEqual(
      expect.arrayContaining([ids.a1, ids.a2, ids.b1]),
    );
    expect(idsOf((await search({ districtId: 'galle', limit: 50 })).body)).toEqual([]);

    // Mirissa: A1/A2 match the place; B1 has no pin and a different place → excluded.
    const mirissa = await search({ placeId: refs.mirissaId, limit: 50 });
    expect(idsOf(mirissa.body).sort()).toEqual([ids.a1, ids.a2].sort());
    expect(mirissa.body.criteria).toMatchObject({
      place: { slug: 'mirissa' },
      radiusKm: expect.any(Number),
    });
    const a1 = mirissa.body.data.find(
      (c: PublicVehicleCard) => c.id === ids.a1,
    ) as PublicVehicleCard;
    expect(a1.distanceKm).not.toBeNull();
    expect(a1.distanceKm as number).toBeLessThan(2);
    // Weligama: B1 by place, plus A1/A2 whose pin is within the default radius.
    const weligama = await search({ placeId: refs.weligamaId, limit: 50 });
    expect(idsOf(weligama.body).sort()).toEqual([ids.a1, ids.a2, ids.b1].sort());
    const b1 = weligama.body.data.find(
      (c: PublicVehicleCard) => c.id === ids.b1,
    ) as PublicVehicleCard;
    expect(b1.distanceKm).toBeNull();
    expect(b1.approxPoint?.source).toBe('place');
    const tight = await search({ placeId: refs.weligamaId, radiusKm: 1, limit: 50 });
    expect(idsOf(tight.body)).toEqual([ids.b1]);
    await search({ placeId: '0192f0a0-0000-7000-8000-000000000999' }, 400);

    expect(idsOf((await search({ minDailyRate: '5000', limit: 50 })).body).sort()).toEqual(
      [ids.a1, ids.b1].sort(),
    );
    expect(idsOf((await search({ maxDailyRate: '3000', limit: 50 })).body)).toEqual([ids.a2]);
    await search({ minDailyRate: '9000', maxDailyRate: '5000' }, 400);
    expect(idsOf((await search({ transmission: 'manual', limit: 50 })).body)).toEqual([ids.a2]);
    expect(idsOf((await search({ fuelType: 'petrol', limit: 50 })).body)).toEqual([ids.a2]);
    expect(idsOf((await search({ minSeats: 6, limit: 50 })).body)).toEqual([ids.b1]);
    expect(idsOf((await search({ hasAc: 'true', limit: 50 })).body)).not.toContain(ids.a2);
    expect(idsOf((await search({ deliveryAvailable: 'true', limit: 50 })).body)).toEqual([ids.a1]);
  });

  it('applies real availability: manual blocks remove overlapping windows, boundaries are half-open, rental length is respected', async () => {
    const blocked = await search({
      startsAt: colomboMidnight(11),
      endsAt: colomboMidnight(12),
      limit: 50,
    });
    expect(idsOf(blocked.body)).not.toContain(ids.a1);
    expect(idsOf(blocked.body)).toContain(ids.b1);
    // A 1-day window is below the bike's minimum of 2 days.
    expect(idsOf(blocked.body)).not.toContain(ids.a2);

    const after = await search({
      startsAt: colomboMidnight(13),
      endsAt: colomboMidnight(16),
      limit: 50,
    });
    expect(idsOf(after.body)).toEqual(expect.arrayContaining([ids.a1, ids.a2, ids.b1]));
    const before = await search({
      startsAt: colomboMidnight(8),
      endsAt: colomboMidnight(10),
      limit: 50,
    });
    expect(idsOf(before.body)).toContain(ids.a1);
    const overlapStart = await search({
      startsAt: colomboMidnight(9),
      endsAt: colomboMidnight(11),
      limit: 50,
    });
    expect(idsOf(overlapStart.body)).not.toContain(ids.a1);

    expect(after.body.criteria.days).toBe(3);
    const a1 = after.body.data.find((c: PublicVehicleCard) => c.id === ids.a1) as PublicVehicleCard;
    expect(a1.estimate).toMatchObject({ days: 3, subtotal: '22500.00', basis: 'daily' });
    await search({ startsAt: colomboMidnight(5) }, 400);
    await search({ startsAt: colomboMidnight(5), endsAt: colomboMidnight(4) }, 400);
    await search({ startsAt: colomboMidnight(5), endsAt: colomboMidnight(120) }, 400);
  });

  it('paginates with a stable cursor and sorts deterministically', async () => {
    const page1 = await search({ sort: 'price_asc', limit: 1 });
    expect(idsOf(page1.body)).toEqual([ids.a2]);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await search({ sort: 'price_asc', limit: 1, cursor: page1.body.nextCursor });
    expect(idsOf(page2.body)).toEqual([ids.a1]);
    const page3 = await search({ sort: 'price_asc', limit: 1, cursor: page2.body.nextCursor });
    expect(idsOf(page3.body)).toEqual([ids.b1]);
    expect(page3.body.nextCursor).toBeNull();

    const desc = await search({ sort: 'price_desc', limit: 50 });
    expect(idsOf(desc.body)).toEqual([ids.b1, ids.a1, ids.a2]);
    const again = await search({ sort: 'price_desc', limit: 50 });
    expect(idsOf(again.body)).toEqual(idsOf(desc.body));

    // Relevance around Mirissa: equal distance → cheaper first.
    const relevance = await search({ placeId: refs.mirissaId, limit: 50 });
    expect(idsOf(relevance.body)).toEqual([ids.a2, ids.a1]);
    const distance = await search({ placeId: refs.weligamaId, sort: 'distance', limit: 50 });
    // Pinned vehicles (with a distance) come before the pin-less one.
    expect(idsOf(distance.body).at(-1)).toBe(ids.b1);

    await search({ sort: 'price_asc', cursor: page1.body.nextCursor, limit: 1 }, 200);
    await search({ sort: 'price_desc', cursor: page1.body.nextCursor, limit: 1 }, 400);
    await search({ cursor: 'garbage' }, 400);
  });

  it('serves a customer-safe detail page by slug or id, with photos, provider summary and availability', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${slugs.a1}`)
      .expect(200);
    expect(PublicVehicleDetailSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body).toMatchObject({
      id: ids.a1,
      slug: slugs.a1,
      title: 'Toyota Aqua 2018 – automatic hybrid',
      rules: { minRenterAge: 21, minLicenceYears: 1, fuelPolicy: 'full_to_full' },
      provider: {
        displayName: 'Mirissa Motors',
        platformApproved: true,
        primaryPlace: { slug: 'mirissa' },
        vehicleCount: 2,
      },
      availability: null,
    });
    expect(detail.body.photos).toHaveLength(3);
    expect(detail.body.photos[0].variants.large).toMatch(/\/large\.webp$/);
    expect(detail.body.provider.approvedSince).toMatch(/^\d{4}-\d{2}$/);

    const byId = await request(app.getHttpServer()).get(`/api/v1/vehicles/${ids.a1}`).expect(200);
    expect(byId.body.slug).toBe(slugs.a1);

    const busy = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${slugs.a1}`)
      .query({ startsAt: colomboMidnight(11), endsAt: colomboMidnight(12) })
      .expect(200);
    expect(busy.body.availability).toMatchObject({
      available: false,
      meetsRentalLength: true,
      days: 1,
    });
    const free = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${slugs.a1}`)
      .query({ startsAt: colomboMidnight(20), endsAt: colomboMidnight(27) })
      .expect(200);
    expect(free.body.availability).toMatchObject({
      available: true,
      days: 7,
      estimate: { subtotal: '45000.00', basis: 'weekly' },
    });
    await request(app.getHttpServer()).get('/api/v1/vehicles/no-such-vehicle').expect(404);
    await request(app.getHttpServer()).get('/api/v1/vehicles/bad slug!').expect(400);
  });

  it('never leaks private data through public responses', async () => {
    const searchJson = JSON.stringify((await search({ placeId: refs.mirissaId, limit: 50 })).body);
    const detailJson = JSON.stringify(
      (await request(app.getHttpServer()).get(`/api/v1/vehicles/${slugs.a1}`).expect(200)).body,
    );
    for (const forbidden of PRIVATE_STRINGS) {
      expect(searchJson, `search leaks ${forbidden}`).not.toContain(forbidden);
      expect(detailJson, `detail leaks ${forbidden}`).not.toContain(forbidden);
    }
    expect(searchJson).not.toContain(providerA.email);
    expect(detailJson).not.toContain(providerA.email);
    // Plates are unique strings like PX-7001; none may appear.
    expect(searchJson).not.toMatch(/PX-\d{4}/);
    expect(detailJson).not.toMatch(/PX-\d{4}/);
    // The public point is the grid point, never the exact pin.
    const detail = JSON.parse(detailJson) as { approxPoint: { lat: number; lng: number } };
    expect(detail.approxPoint).toEqual({ lat: 5.95, lng: 80.47, source: 'approximate' });
  });

  it('suggests places from the gazetteer by name and alias', async () => {
    const mir = await request(app.getHttpServer())
      .get('/api/v1/places/suggest')
      .query({ q: 'mir' })
      .expect(200);
    expect(mir.body[0]).toMatchObject({
      slug: 'mirissa',
      districtId: 'matara',
      districtName: expect.any(String),
    });
    const alias = await request(app.getHttpServer())
      .get('/api/v1/places/suggest')
      .query({ q: 'weligama bay' })
      .expect(200);
    expect(alias.body.map((p: { slug: string }) => p.slug)).toContain('weligama');
    const none = await request(app.getHttpServer())
      .get('/api/v1/places/suggest')
      .query({ q: 'zzzz' })
      .expect(200);
    expect(none.body).toEqual([]);
    await request(app.getHttpServer()).get('/api/v1/places/suggest').expect(400);
    const inactive = await request(app.getHttpServer())
      .get('/api/v1/places/suggest')
      .query({ q: 'colombo' })
      .expect(200);
    expect(inactive.body).toEqual([]);
  });
});
