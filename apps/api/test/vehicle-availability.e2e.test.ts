import type { NestExpressApplication } from '@nestjs/platform-express';
import { VehicleAvailabilitySchema, VehicleHoldSchema } from '@vrp/contracts';
import { auditEvents, runMigrations, vehicleHolds, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  adminVehicleAction,
  approvedProvider,
  approvedVehicle,
  blockRequest,
  colomboMidnight,
  createVehicle,
  newLocation,
  vehicleAction,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping vehicle availability e2e tests');

const SCOPE = 'pavl';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('vehicle availability (manual blocks)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let locationId: string;
  let plateCounter = 3000;
  const nextPlate = () => `WP CAB-${(plateCounter += 1)}`;

  const availability = (
    token: string,
    vehicleId: string,
    from: string,
    to: string,
    expected = 200,
  ) =>
    request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${vehicleId}/availability`)
      .query({ from, to })
      .set(auth(token))
      .expect(expected);

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

  it('reports an approved vehicle as available unless a block overlaps the window', async () => {
    const token = provider.body.accessToken;
    const vehicle = await approvedVehicle(app, token, admin.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    const free = await availability(token, vehicle.id, colomboMidnight(10), colomboMidnight(12));
    expect(VehicleAvailabilitySchema.safeParse(free.body).success).toBe(true);
    expect(free.body).toMatchObject({ bookable: true, available: true, holds: [] });

    const block = await blockRequest(app, token, vehicle.id, {
      startsAt: colomboMidnight(10),
      endsAt: colomboMidnight(13),
      reason: 'maintenance',
      note: 'Service at the garage.',
    });
    expect(VehicleHoldSchema.safeParse(block.body).success).toBe(true);
    expect(block.body).toMatchObject({
      kind: 'block',
      reason: 'maintenance',
      createdBy: provider.userId,
    });

    const inside = await availability(token, vehicle.id, colomboMidnight(11), colomboMidnight(12));
    expect(inside.body).toMatchObject({ bookable: true, available: false });
    expect(inside.body.holds).toHaveLength(1);
    // Half-open periods: a window starting exactly when the block ends is free.
    const after = await availability(token, vehicle.id, colomboMidnight(13), colomboMidnight(15));
    expect(after.body.available).toBe(true);
    const before = await availability(token, vehicle.id, colomboMidnight(8), colomboMidnight(10));
    expect(before.body.available).toBe(true);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${vehicle.id}/blocks`)
      .set(auth(token))
      .expect(200);
    expect(list.body.map((h: { id: string }) => h.id)).toContain(block.body.id);
  });

  it('rejects invalid ranges, past blocks and unknown reasons', async () => {
    const token = provider.body.accessToken;
    const vehicle = await approvedVehicle(app, token, admin.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    const backwards = await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: colomboMidnight(5), endsAt: colomboMidnight(4), reason: 'other' },
      400,
    );
    expect(backwards.body.error.details[0].field).toBe('endsAt');
    const past = await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: colomboMidnight(-10), endsAt: colomboMidnight(-5), reason: 'other' },
      400,
    );
    expect(past.body.error.details[0].issue).toMatch(/past/);
    await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: colomboMidnight(1), endsAt: colomboMidnight(400), reason: 'other' },
      400,
    );
    await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: colomboMidnight(1), endsAt: colomboMidnight(2), reason: 'holiday' },
      400,
    );
    await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: 'tomorrow', endsAt: colomboMidnight(2), reason: 'other' },
      400,
    );
    await availability(token, vehicle.id, colomboMidnight(2), colomboMidnight(1), 400);
  });

  it('refuses overlapping blocks (409) and lets the database win races', async () => {
    const token = provider.body.accessToken;
    const vehicle = await approvedVehicle(app, token, admin.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    await blockRequest(app, token, vehicle.id, {
      startsAt: colomboMidnight(20),
      endsAt: colomboMidnight(25),
      reason: 'rented_offline',
    });
    const overlap = await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: colomboMidnight(24), endsAt: colomboMidnight(27), reason: 'other' },
      409,
    );
    expect(overlap.body.error.code).toBe('AVAILABILITY_CONFLICT');
    expect(overlap.body.error.details[0].issue).toMatch(/overlaps block/);
    // Touching periods do not overlap.
    await blockRequest(app, token, vehicle.id, {
      startsAt: colomboMidnight(25),
      endsAt: colomboMidnight(26),
      reason: 'other',
    });

    // Two concurrent inserts straight into the table: exactly one survives the exclusion constraint.
    const start = new Date(colomboMidnight(40));
    const end = new Date(colomboMidnight(45));
    const insert = () =>
      handle.db
        .insert(vehicleHolds)
        .values({
          vehicleId: vehicle.id,
          startsAt: start,
          endsAt: end,
          kind: 'block',
          blockReason: 'other',
        })
        .returning();
    const results = await Promise.allSettled([insert(), insert()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const cause = rejected[0]?.reason as { cause?: { code?: string }; code?: string };
    expect(cause.cause?.code ?? cause.code).toBe('23P01');
  });

  it('never reports unapproved, inactive or suspended vehicles as available', async () => {
    const token = provider.body.accessToken;
    const draft = await createVehicle(app, token, { categoryId: 'car' });
    const asDraft = await blockRequest(
      app,
      token,
      draft.body.id,
      { startsAt: colomboMidnight(1), endsAt: colomboMidnight(2), reason: 'other' },
      409,
    );
    expect(asDraft.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const draftWindow = await availability(
      token,
      draft.body.id,
      colomboMidnight(1),
      colomboMidnight(2),
    );
    expect(draftWindow.body).toMatchObject({ bookable: false, available: false });

    const vehicle = await approvedVehicle(app, token, admin.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    await vehicleAction(app, token, vehicle.id, 'deactivate');
    const inactive = await availability(token, vehicle.id, colomboMidnight(1), colomboMidnight(2));
    expect(inactive.body).toMatchObject({ status: 'inactive', bookable: false, available: false });
    // Blocks may still be managed while inactive.
    await blockRequest(app, token, vehicle.id, {
      startsAt: colomboMidnight(50),
      endsAt: colomboMidnight(51),
      reason: 'provider_unavailable',
    });
    await adminVehicleAction(app, admin.body.accessToken, vehicle.id, 'suspend', {
      reason: 'Insurance lapsed.',
    });
    const suspended = await availability(
      token,
      vehicle.id,
      colomboMidnight(60),
      colomboMidnight(61),
    );
    expect(suspended.body).toMatchObject({
      status: 'suspended',
      bookable: false,
      available: false,
      holds: [],
    });
    await blockRequest(
      app,
      token,
      vehicle.id,
      { startsAt: colomboMidnight(60), endsAt: colomboMidnight(61), reason: 'other' },
      409,
    );
  });

  it('keeps availability private to the owning provider and closed to customers', async () => {
    const token = provider.body.accessToken;
    const vehicle = await approvedVehicle(app, token, admin.body.accessToken, locationId, {
      registrationNumber: nextPlate(),
    });
    const block = await blockRequest(app, token, vehicle.id, {
      startsAt: colomboMidnight(70),
      endsAt: colomboMidnight(71),
      reason: 'other',
    });
    const other = await approvedProvider(app, nextEmail(), refs, admin, 'Other Fleet');
    const otherToken = other.body.accessToken;
    await availability(otherToken, vehicle.id, colomboMidnight(70), colomboMidnight(71), 404);
    await blockRequest(
      app,
      otherToken,
      vehicle.id,
      { startsAt: colomboMidnight(80), endsAt: colomboMidnight(81), reason: 'other' },
      404,
    );
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/vehicles/${vehicle.id}/blocks/${block.body.id}`)
      .set(auth(otherToken))
      .expect(404);
    const customer = await newVerifiedUser(app, nextEmail());
    await availability(
      customer.body.accessToken,
      vehicle.id,
      colomboMidnight(70),
      colomboMidnight(71),
      403,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/vehicles/${vehicle.id}/blocks/${block.body.id}`)
      .set(auth(token))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/vehicles/${vehicle.id}/blocks/${block.body.id}`)
      .set(auth(token))
      .expect(404);
    const actions = (
      await handle.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(and(eq(auditEvents.targetType, 'vehicle'), eq(auditEvents.targetId, vehicle.id)))
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['vehicle_block.created', 'vehicle_block.deleted']),
    );
  });
});
