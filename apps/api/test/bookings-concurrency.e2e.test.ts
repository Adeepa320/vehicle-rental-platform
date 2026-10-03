import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Booking, Vehicle } from '@vrp/contracts';
import { runMigrations, vehicleHolds, type DatabaseHandle } from '@vrp/database';
import { and, eq, gt, lt } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import {
  getBooking,
  providerBookingAction,
  requestBooking,
  windowAllocator,
} from './utils/booking-helpers';
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
  blockRequest,
  colomboMidnight,
  newLocation,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping booking concurrency tests');

const SCOPE = 'bkcc';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * The double-booking guarantee (DATABASE_DESIGN §7, TECH_DECISIONS D14): no
 * sequence of concurrent accepts, blocks or cancellations may ever leave two
 * overlapping holds on one vehicle. These tests fire the real HTTP requests in
 * parallel against the real database.
 */
describe.skipIf(!url)('bookings (concurrency and hold integrity)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let customerA: ApplicantSession;
  let customerB: ApplicantSession;
  let vehicle: Vehicle;
  const nextWindow = windowAllocator(colomboMidnight, 10);

  const holdsIn = async (startsAt: string, endsAt: string) =>
    handle.db
      .select()
      .from(vehicleHolds)
      .where(
        and(
          eq(vehicleHolds.vehicleId, vehicle.id),
          lt(vehicleHolds.startsAt, new Date(endsAt)),
          gt(vehicleHolds.endsAt, new Date(startsAt)),
        ),
      );

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Race Rentals');
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicle = await approvedVehicle(
      app,
      provider.body.accessToken,
      admin.body.accessToken,
      locationId,
      {
        registrationNumber: 'WP KB-7001',
      },
    );
    customerA = await newVerifiedUser(app, nextEmail());
    customerB = await newVerifiedUser(app, nextEmail());
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('never lets two parallel accepts for overlapping requests both succeed', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = nextWindow(2);
      const a = await requestBooking(
        app,
        customerA.body.accessToken,
        vehicle.id,
        w.startsAt,
        w.endsAt,
      );
      const b = await requestBooking(
        app,
        customerB.body.accessToken,
        vehicle.id,
        w.startsAt,
        w.endsAt,
      );
      const [ra, rb] = await Promise.all([
        providerBookingAction(app, provider.body.accessToken, a.id, 'accept', { version: 1 }),
        providerBookingAction(app, provider.body.accessToken, b.id, 'accept', { version: 1 }),
      ]);
      const statuses = [ra.status, rb.status].sort();
      expect(statuses, `round ${round}: ${JSON.stringify([ra.body, rb.body])}`).toEqual([200, 409]);
      const loser = ra.status === 200 ? rb : ra;
      expect(['STALE_VERSION', 'BOOKING_CONFLICT', 'INVALID_STATE_TRANSITION']).toContain(
        loser.body.error.code,
      );
      const holds = await holdsIn(w.startsAt, w.endsAt);
      expect(holds, `round ${round}`).toHaveLength(1);
      const winner = ra.status === 200 ? a : b;
      expect(holds[0]?.bookingId).toBe(winner.id);
      const other = ra.status === 200 ? b : a;
      const otherToken =
        other.id === a.id ? customerA.body.accessToken : customerB.body.accessToken;
      const otherNow = (await getBooking(app, otherToken, other.id)).body as Booking;
      expect(otherNow.status).toBe('declined');
      expect(otherNow.declineReason).toBe('vehicle_no_longer_available');
    }
  });

  it('treats a double-click accept on the same booking as one accept', async () => {
    const w = nextWindow(2);
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        providerBookingAction(app, provider.body.accessToken, a.id, 'accept', { version: 1 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('STALE_VERSION');
    }
    expect(await holdsIn(w.startsAt, w.endsAt)).toHaveLength(1);
    const final = (await getBooking(app, customerA.body.accessToken, a.id)).body as Booking;
    expect(final).toMatchObject({ status: 'accepted', version: 2 });
  });

  it('lets exactly one of an accept and a concurrent manual block win', async () => {
    const w = nextWindow(2);
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    const [accept, block] = await Promise.all([
      providerBookingAction(app, provider.body.accessToken, a.id, 'accept', { version: 1 }),
      request(app.getHttpServer())
        .post(`/api/v1/providers/me/vehicles/${vehicle.id}/blocks`)
        .set(auth(provider.body.accessToken))
        .send({ startsAt: w.startsAt, endsAt: w.endsAt, reason: 'maintenance' }),
    ]);
    const outcomes = [accept.status === 200, block.status === 201];
    expect(
      outcomes.filter(Boolean),
      JSON.stringify({ accept: accept.body, block: block.body }),
    ).toHaveLength(1);
    expect(await holdsIn(w.startsAt, w.endsAt)).toHaveLength(1);
    if (accept.status !== 200) expect(accept.body.error.code).toBe('BOOKING_CONFLICT');
    if (block.status !== 201) expect(block.body.error.code).toBe('AVAILABILITY_CONFLICT');
  });

  it('refuses to accept a request once a manual block covers the period', async () => {
    const w = nextWindow(2);
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      w.startsAt,
      w.endsAt,
    );
    await blockRequest(app, provider.body.accessToken, vehicle.id, {
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      reason: 'provider_unavailable',
    });
    const refused = await providerBookingAction(app, provider.body.accessToken, a.id, 'accept', {
      version: 1,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('BOOKING_CONFLICT');
    expect((await getBooking(app, customerA.body.accessToken, a.id)).body.status).toBe('requested');
    expect(await holdsIn(w.startsAt, w.endsAt)).toHaveLength(1); // the block only
  });

  it('accepts adjacent half-open windows and reuses a window after a cancellation', async () => {
    const first = nextWindow(2);
    const second = { startsAt: first.endsAt, endsAt: colomboMidnight(first.startDay + 4) };
    nextWindow(2); // keep the allocator clear of `second`
    const a = await requestBooking(
      app,
      customerA.body.accessToken,
      vehicle.id,
      first.startsAt,
      first.endsAt,
    );
    const b = await requestBooking(
      app,
      customerB.body.accessToken,
      vehicle.id,
      second.startsAt,
      second.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      a.id,
      'accept',
      { version: 1 },
      200,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      b.id,
      'accept',
      { version: 1 },
      200,
    );
    expect(await holdsIn(first.startsAt, second.endsAt)).toHaveLength(2);
    // Accepting `a` must not have auto-declined the adjacent request `b`.
    expect((await getBooking(app, customerB.body.accessToken, b.id)).body.status).toBe('accepted');

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${a.id}/cancel`)
      .set(auth(customerA.body.accessToken))
      .send({ version: 2 })
      .expect(200);
    expect(await holdsIn(first.startsAt, first.endsAt)).toHaveLength(0);
    const again = await requestBooking(
      app,
      customerB.body.accessToken,
      vehicle.id,
      first.startsAt,
      first.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      again.id,
      'accept',
      { version: 1 },
      200,
    );
    expect(await holdsIn(first.startsAt, first.endsAt)).toHaveLength(1);
  });
});
