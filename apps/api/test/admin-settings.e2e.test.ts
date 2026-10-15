import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminSettingsResponseSchema,
  type AdminSetting,
  type AdminSettingsResponse,
  type Booking,
} from '@vrp/contracts';
import {
  auditEvents,
  bookings,
  platformSettings,
  runMigrations,
  type DatabaseHandle,
} from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { grantRole } from '../src/cli/grant-admin.js';
import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import { providerBookingAction, requestBooking, windowAllocator } from './utils/booking-helpers';
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
  colomboMidnight,
  newLocation,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin settings e2e tests');

const SCOPE = 'aset';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('platform settings administration (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let superAdmin: ApplicantSession;
  let provider: ProviderSession;
  let customer: ApplicantSession;
  let vehicleId: string;
  const nextWindow = windowAllocator(colomboMidnight, 50);

  const api = () => request(app.getHttpServer());
  const list = async (token = admin.body.accessToken): Promise<AdminSettingsResponse> => {
    const res = await api().get('/api/v1/admin/settings').set(auth(token)).expect(200);
    expect(AdminSettingsResponseSchema.safeParse(res.body).success).toBe(true);
    return res.body as AdminSettingsResponse;
  };
  const setting = async (key: string): Promise<AdminSetting> => {
    const row = (await list()).data.find((s) => s.key === key);
    if (!row) throw new Error(`setting ${key} missing`);
    return row;
  };
  const put = (body: Record<string, unknown>, token = superAdmin.body.accessToken) =>
    api().put('/api/v1/admin/settings').set(auth(token)).send(body);
  const change = async (key: string, value: unknown, reason?: string) => {
    const current = await setting(key);
    return put({
      changes: [{ key, value, expectedUpdatedAt: current.updatedAt }],
      ...(reason ? { reason } : {}),
    });
  };
  const changeMany = async (entries: [string, unknown][], reason?: string) => {
    const changes = [];
    for (const [key, value] of entries)
      changes.push({ key, value, expectedUpdatedAt: (await setting(key)).updatedAt });
    return put({ changes, ...(reason ? { reason } : {}) });
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    superAdmin = await newAdmin(app, nextEmail());
    await grantRole(handle.db, superAdmin.email, 'super_admin');
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Settings Rentals');
    customer = await newVerifiedUser(app, nextEmail());
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicleId = (
      await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
        registrationNumber: 'ST-5001',
      })
    ).id;
  });

  afterAll(async () => {
    // Leave the shared test database as the seed left it.
    await handle.db
      .update(platformSettings)
      .set({ value: 10 })
      .where(eq(platformSettings.key, 'advance_percentage'));
    await handle.db
      .update(platformSettings)
      .set({ value: 10 })
      .where(eq(platformSettings.key, 'default_commission_rate'));
    await handle.db
      .update(platformSettings)
      .set({ value: 24 })
      .where(eq(platformSettings.key, 'provider_response_hours'));
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('lets admins read the typed allow-list but only super admins change it', async () => {
    const page = await list();
    const keys = page.data.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'provider_response_hours',
        'advance_percentage',
        'default_commission_rate',
        'dispute_window_days',
        'indicative_exchange_rates',
        'auto_pause_on_document_expiry',
      ]),
    );
    expect(page.readOnly.map((r) => r.key)).toEqual(expect.arrayContaining(['currency']));
    const customerRes = await api()
      .get('/api/v1/admin/settings')
      .set(auth(customer.body.accessToken))
      .expect(403);
    expect(customerRes.body.error.code).toBe('FORBIDDEN');
    await api().get('/api/v1/admin/settings').set(auth(provider.body.accessToken)).expect(403);
    await api().get('/api/v1/admin/settings').expect(401);
    const asAdmin = await change('no_show_grace_hours', 4).then((r) => r);
    expect(asAdmin.status).toBe(200); // super admin token is the default for `change`
    const ordinary = await put(
      {
        changes: [
          {
            key: 'no_show_grace_hours',
            value: 5,
            expectedUpdatedAt: (await setting('no_show_grace_hours')).updatedAt,
          },
        ],
      },
      admin.body.accessToken,
    ).expect(403);
    expect(ordinary.body.error.code).toBe('FORBIDDEN');
    await changeMany([['no_show_grace_hours', 3]]).then((r) => expect(r.status).toBe(200));
  });

  it('validates values, requires a reason for high-impact keys, refuses stale tokens and unknown keys, and audits old / new', async () => {
    const invalid = await change('provider_response_hours', -5, 'negative');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details[0].field).toBe('changes.provider_response_hours');
    const noReason = await change('provider_response_hours', 36);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].field).toBe('reason');
    const unknown = await put({
      changes: [
        { key: 'payhere_merchant_secret', value: 'x', expectedUpdatedAt: new Date().toISOString() },
      ],
    });
    expect(unknown.status).toBe(400);
    const stale = await setting('provider_response_hours');
    const ok = await change(
      'provider_response_hours',
      36,
      'Providers asked for more time during the season',
    );
    expect(ok.status).toBe(200);
    expect(
      ok.body.data.find((s: AdminSetting) => s.key === 'provider_response_hours'),
    ).toMatchObject({ value: 36, updatedBy: superAdmin.userId });
    const replay = await put({
      changes: [{ key: 'provider_response_hours', value: 40, expectedUpdatedAt: stale.updatedAt }],
      reason: 'stale token from an old page',
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('SETTING_STALE');
    expect((await setting('provider_response_hours')).value).toBe(36);
    const rows = await handle.db
      .select({
        metadata: auditEvents.metadata,
        reason: auditEvents.reason,
        actorUserId: auditEvents.actorUserId,
      })
      .from(auditEvents)
      .where(eq(auditEvents.action, 'setting.updated'));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: superAdmin.userId,
          reason: 'Providers asked for more time during the season',
          metadata: { key: 'provider_response_hours', before: 24, after: 36 },
        }),
      ]),
    );
    const radius = await changeMany([
      ['default_search_radius_km', 80],
      ['max_search_radius_km', 50],
    ]);
    expect(radius.status).toBe(400);
    expect(radius.body.error.details[0].field).toBe('changes.default_search_radius_km');
  });

  it('keeps the money pair coupled and applies a change to new bookings only', async () => {
    const w = nextWindow(2);
    const existing = await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      existing.id,
      'accept',
      { version: 1 },
      200,
    );
    expect(existing.price.advancePercentage).toBe('10.00');
    const alone = await change('advance_percentage', 15, 'Raise the advance');
    expect(alone.status).toBe(409);
    expect(alone.body.error.code).toBe('SETTING_MONEY_MODEL_UNSUPPORTED');
    expect((await setting('advance_percentage')).value).toBe(10);
    const commissionAlone = await change('default_commission_rate', 12, 'Raise the commission');
    expect(commissionAlone.status).toBe(409);
    const together = await changeMany(
      [
        ['advance_percentage', 15],
        ['default_commission_rate', 15],
      ],
      'Business decision: 15 % commission from November',
    );
    expect(together.status).toBe(200);
    expect(
      together.body.data.find((s: AdminSetting) => s.key === 'advance_percentage')?.value,
    ).toBe(15);
    // The existing booking keeps its snapshot; a new request is priced with the new percentage.
    const [snapshot] = await handle.db
      .select({
        advancePercentage: bookings.advancePercentage,
        advanceAmount: bookings.advanceAmount,
      })
      .from(bookings)
      .where(eq(bookings.id, existing.id));
    expect(snapshot).toEqual({ advancePercentage: '10.00', advanceAmount: existing.price.advance });
    const w2 = nextWindow(2);
    const fresh = (await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w2.startsAt,
      w2.endsAt,
    )) as Booking;
    expect(fresh.price.advancePercentage).toBe('15.00');
    expect(fresh.price.subtotal).toBe(existing.price.subtotal);
    expect(fresh.price.advance).not.toBe(existing.price.advance);
    expect(Number(fresh.price.advance)).toBeCloseTo(Number(fresh.price.subtotal) * 0.15, 0);
    const back = await changeMany(
      [
        ['advance_percentage', 10],
        ['default_commission_rate', 10],
      ],
      'Restore the launch defaults',
    );
    expect(back.status).toBe(200);
  });
});
