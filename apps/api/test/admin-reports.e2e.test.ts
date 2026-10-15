import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminOverviewSchema,
  AuditEventListSchema,
  ProviderReportSchema,
  ReportsOverviewSchema,
  amountToCents,
  centsToAmount,
  type AdminOverview,
  type AuditEventList,
  type Booking,
  type ReportQuery,
  type ReportsOverview,
} from '@vrp/contracts';
import {
  paymentEvents,
  payments,
  runMigrations,
  searchLogs,
  type DatabaseHandle,
} from '@vrp/database';
import { and, asc, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { colomboDay } from '../src/common/colombo-dates';
import { DATABASE_HANDLE } from '../src/database/database.module';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import { providerBookingAction, requestBooking, windowAllocator } from './utils/booking-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { payAdvance } from './utils/payment-helpers';
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
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin reports / audit e2e tests');

const SCOPE = 'arpt';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const sum = (...amounts: string[]) =>
  centsToAmount(amounts.reduce((acc, a) => acc + amountToCents(a), 0n));

describe.skipIf(!url)('reports, search logs, audit viewer and overview (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let customer: ApplicantSession;
  let vehicleId: string;
  const nextWindow = windowAllocator(colomboMidnight, 60);
  const today = colomboDay();

  const api = () => request(app.getHttpServer());
  const overview = async (): Promise<ReportsOverview> => {
    const res = await api()
      .get('/api/v1/admin/reports/overview')
      .query({ from: today, to: today })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(ReportsOverviewSchema.safeParse(res.body).success).toBe(true);
    return res.body as ReportsOverview;
  };
  const delta = (before: string, after: string) =>
    centsToAmount(amountToCents(after) - amountToCents(before));
  const accepted = async (): Promise<Booking> => {
    const w = nextWindow(2);
    const b = await requestBooking(app, customer.body.accessToken, vehicleId, w.startsAt, w.endsAt);
    return (
      await providerBookingAction(
        app,
        provider.body.accessToken,
        b.id,
        'accept',
        { version: 1 },
        200,
      )
    ).body as Booking;
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(
      app,
      nextEmail(),
      refs,
      admin,
      '=HYPERLINK("http://evil") Rentals මාතර',
    );
    customer = await newVerifiedUser(app, nextEmail());
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    vehicleId = (
      await approvedVehicle(app, provider.body.accessToken, admin.body.accessToken, locationId, {
        registrationNumber: 'RP-6001',
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('computes funnel, status, GMV and money exactly from seeded bookings (deltas against the shared database)', async () => {
    const before = await overview();
    // 1) completed with a paid advance; 2) accepted, paid, cancelled by the provider → refund due, then refunded; 3) declined request.
    const done = await accepted();
    await payAdvance(app, customer.body.accessToken, done.id);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      done.id,
      'pickup',
      { version: 3 },
      200,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      done.id,
      'return',
      { version: 4 },
      200,
    );
    const cancelled = await accepted();
    await payAdvance(app, customer.body.accessToken, cancelled.id);
    await providerBookingAction(
      app,
      provider.body.accessToken,
      cancelled.id,
      'cancel',
      { version: 3 },
      200,
    );
    const [refundDue] = await handle.db
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(eq(payments.bookingId, cancelled.id));
    const midway = await overview();
    expect(midway.money.refundDueCount - before.money.refundDueCount).toBe(1);
    expect(delta(before.money.refundDueAmount, midway.money.refundDueAmount)).toBe(
      refundDue?.amount,
    );
    await api()
      .post(`/api/v1/admin/payments/${refundDue?.id}/refund`)
      .set(auth(admin.body.accessToken))
      .send({
        mode: 'manual',
        amount: refundDue?.amount,
        reason: 'Provider cancellation refund',
        reference: 'PH-REF-1',
      })
      .expect(200);
    const w = nextWindow(2);
    const declined = await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w.startsAt,
      w.endsAt,
    );
    await providerBookingAction(
      app,
      provider.body.accessToken,
      declined.id,
      'decline',
      { version: 1, reason: 'other', note: 'Not available after all' },
      200,
    );

    const after = await overview();
    expect(after.funnel.requested - before.funnel.requested).toBe(3);
    expect(after.funnel.accepted - before.funnel.accepted).toBe(2);
    expect(after.funnel.confirmed - before.funnel.confirmed).toBe(2);
    expect(after.funnel.active - before.funnel.active).toBe(1);
    expect(after.funnel.completed - before.funnel.completed).toBe(1);
    expect(after.statusCounts.completed - before.statusCounts.completed).toBe(1);
    expect(
      after.statusCounts.cancelled_by_provider - before.statusCounts.cancelled_by_provider,
    ).toBe(1);
    expect(after.statusCounts.declined - before.statusCounts.declined).toBe(1);
    expect(delta(before.gmv.confirmedGmv, after.gmv.confirmedGmv)).toBe(
      sum(done.price.subtotal, cancelled.price.subtotal),
    );
    expect(delta(before.gmv.completedGmv, after.gmv.completedGmv)).toBe(done.price.subtotal);
    expect(after.gmv.completedCount - before.gmv.completedCount).toBe(1);
    expect(delta(before.money.advancesCollected, after.money.advancesCollected)).toBe(
      sum(done.price.advance, cancelled.price.advance),
    );
    expect(after.money.advancesCount - before.money.advancesCount).toBe(2);
    expect(delta(before.money.refundedAmount, after.money.refundedAmount)).toBe(
      cancelled.price.advance,
    );
    expect(after.money.refundDueCount).toBe(before.money.refundDueCount);
    expect(delta(before.money.estimatedPlatformRevenue, after.money.estimatedPlatformRevenue)).toBe(
      done.price.advance,
    );
    expect(after.operations.providerCancellations - before.operations.providerCancellations).toBe(
      1,
    );
    expect(
      after.supplyDemand.bookingsByPlace.find((p) => p.id === refs.mirissaId)?.count ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(
      after.supplyDemand.bookingsByCategory.find((c) => c.id === 'car')?.count ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(after.money.currency).toBe('LKR');
    // Range validation.
    await api()
      .get('/api/v1/admin/reports/overview')
      .query({ from: today, to: '2020-01-01' })
      .set(auth(admin.body.accessToken))
      .expect(400);
    await api()
      .get('/api/v1/admin/reports/overview')
      .query({ from: today, to: today })
      .set(auth(customer.body.accessToken))
      .expect(403);
  });

  it('reports refunds per period from the recorded movements, never from the cumulative payment row', async () => {
    // Phase 7 partial refunds accumulate on the row (`refunded_amount` 2250.00, `refunded_at` =
    // the latest movement); each movement must be reported in the period it was recorded.
    const periodA: ReportQuery = { from: '2026-03-03', to: '2026-03-03' };
    const periodB: ReportQuery = { from: '2026-03-12', to: '2026-03-12' };
    const both: ReportQuery = { from: '2026-03-01', to: '2026-03-31' };
    const firstAt = new Date('2026-03-03T10:00:00+05:30');
    const secondAt = new Date('2026-03-12T16:30:00+05:30');
    const report = async (range: ReportQuery): Promise<ReportsOverview> => {
      const res = await api()
        .get('/api/v1/admin/reports/overview')
        .query(range)
        .set(auth(admin.body.accessToken))
        .expect(200);
      expect(ReportsOverviewSchema.safeParse(res.body).success).toBe(true);
      return res.body as ReportsOverview;
    };
    const beforeA = await report(periodA);
    const beforeB = await report(periodB);
    const beforeBoth = await report(both);
    const beforeToday = await overview();

    const w = nextWindow(3);
    const requested = await requestBooking(
      app,
      customer.body.accessToken,
      vehicleId,
      w.startsAt,
      w.endsAt,
    );
    const booking = (
      await providerBookingAction(
        app,
        provider.body.accessToken,
        requested.id,
        'accept',
        { version: 1 },
        200,
      )
    ).body as Booking;
    expect(booking.price.advance).toBe('2250.00');
    await payAdvance(app, customer.body.accessToken, booking.id);
    const [payment] = await handle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    const paymentId = payment?.id as string;
    const service = app.get(PaymentsService);
    const actor: AuthenticatedUser = {
      id: admin.userId,
      email: admin.email,
      roles: ['admin'],
      sessionId: 'reports-e2e',
    };
    const refund = (amount: string, reference: string, now: Date) =>
      service.recordRefund(
        actor,
        paymentId,
        { mode: 'manual', amount, reason: `Partial refund ${reference}`, reference },
        {},
        now,
      );

    const first = await refund('1000.00', 'BT-A', firstAt);
    expect(first).toMatchObject({ status: 'paid', refundedAmount: '1000.00' });
    const afterFirst = await report(periodA);
    expect(delta(beforeA.money.refundedAmount, afterFirst.money.refundedAmount)).toBe('1000.00');

    const second = await refund('1250.00', 'BT-B', secondAt);
    expect(second).toMatchObject({
      status: 'refunded',
      refundedAmount: '2250.00',
      refundedAt: secondAt.toISOString(),
    });

    // Period A still reports its own movement after the later refund; B carries only the second.
    const afterA = await report(periodA);
    const afterB = await report(periodB);
    const afterBoth = await report(both);
    const afterToday = await overview();
    expect(delta(beforeA.money.refundedAmount, afterA.money.refundedAmount)).toBe('1000.00');
    expect(afterA.money.refundsCount - beforeA.money.refundsCount).toBe(1);
    expect(delta(beforeB.money.refundedAmount, afterB.money.refundedAmount)).toBe('1250.00');
    expect(afterB.money.refundsCount - beforeB.money.refundsCount).toBe(1);
    expect(delta(beforeBoth.money.refundedAmount, afterBoth.money.refundedAmount)).toBe('2250.00');
    expect(afterBoth.money.refundsCount - beforeBoth.money.refundsCount).toBe(2);
    // The estimate follows the period refunds; the advance itself was collected today, not in March.
    expect(delta(beforeA.money.advancesCollected, afterA.money.advancesCollected)).toBe('0.00');
    expect(
      delta(beforeA.money.estimatedPlatformRevenue, afterA.money.estimatedPlatformRevenue),
    ).toBe('-1000.00');
    expect(
      delta(beforeB.money.estimatedPlatformRevenue, afterB.money.estimatedPlatformRevenue),
    ).toBe('-1250.00');
    expect(
      delta(beforeBoth.money.estimatedPlatformRevenue, afterBoth.money.estimatedPlatformRevenue),
    ).toBe('-2250.00');
    expect(delta(beforeToday.money.advancesCollected, afterToday.money.advancesCollected)).toBe(
      '2250.00',
    );
    expect(delta(beforeToday.money.refundedAmount, afterToday.money.refundedAmount)).toBe('0.00');
    expect(afterToday.money.refundsCount).toBe(beforeToday.money.refundsCount);
    expect(
      delta(beforeToday.money.estimatedPlatformRevenue, afterToday.money.estimatedPlatformRevenue),
    ).toBe('2250.00');

    // Phase 7 behaviour unchanged: one cumulative row, built from two append-only movements.
    const [row] = await handle.db.select().from(payments).where(eq(payments.id, paymentId));
    expect(row).toMatchObject({
      status: 'refunded',
      refundedAmount: '2250.00',
      refundDueAmount: '0.00',
    });
    expect(row?.refundedAt?.toISOString()).toBe(secondAt.toISOString());
    const movements = await handle.db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.paymentId, paymentId),
          eq(paymentEvents.action, 'payment.refund_recorded'),
        ),
      )
      .orderBy(asc(paymentEvents.createdAt));
    expect(movements.map((m) => [m.metadata?.amount, m.createdAt.toISOString()])).toEqual([
      ['1000.00', firstAt.toISOString()],
      ['1250.00', secondAt.toISOString()],
    ]);

    // The CSV carries the same period figures (a negative estimate stays a plain number).
    const csv = await api()
      .get('/api/v1/admin/reports/overview.csv')
      .query(periodA)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(csv.text).toContain(`money,refundedAmount,${afterA.money.refundedAmount}\r\n`);
    expect(csv.text).toContain(`money,refundsCount,${afterA.money.refundsCount}\r\n`);
    expect(csv.text).toContain(
      `money,estimatedPlatformRevenue,${afterA.money.estimatedPlatformRevenue}\r\n`,
    );
    expect(afterA.money.estimatedPlatformRevenue.startsWith('-')).toBe(
      amountToCents(afterA.money.advancesCollected) < amountToCents(afterA.money.refundedAmount),
    );
  });

  it('logs zero-result searches without PII and leaves search results unchanged', async () => {
    const before = await overview();
    const hit = await api()
      .get('/api/v1/vehicles/search')
      .query({ placeId: refs.mirissaId, categoryId: 'car', limit: 50 })
      .expect(200);
    expect(hit.body.data.map((c: { id: string }) => c.id)).toContain(vehicleId);
    const miss = await api()
      .get('/api/v1/vehicles/search')
      .query({
        placeId: refs.gallePlaceId,
        categoryId: 'van',
        startsAt: colomboMidnight(70),
        endsAt: colomboMidnight(72),
        transmission: 'automatic',
      })
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect(miss.body.data).toEqual([]);
    expect(miss.body.criteria.place.id).toBe(refs.gallePlaceId);
    // The second page of a search (cursor) is not logged again.
    const firstPage = await api()
      .get('/api/v1/vehicles/search')
      .query({ placeId: refs.mirissaId, categoryId: 'car', limit: 1 })
      .expect(200);
    if (firstPage.body.nextCursor) {
      await api()
        .get('/api/v1/vehicles/search')
        .query({
          placeId: refs.mirissaId,
          categoryId: 'car',
          limit: 1,
          cursor: firstPage.body.nextCursor,
        })
        .expect(200);
    }
    const [latest] = await handle.db
      .select()
      .from(searchLogs)
      .where(eq(searchLogs.placeId, refs.gallePlaceId))
      .orderBy(desc(searchLogs.createdAt))
      .limit(1);
    expect(latest).toMatchObject({
      placeId: refs.gallePlaceId,
      districtId: 'galle',
      categoryId: 'van',
      resultCount: 0,
      startsOn: colomboMidnight(70).slice(0, 10),
      endsOn: colomboMidnight(72).slice(0, 10),
    });
    expect(latest?.filters).toEqual(
      expect.objectContaining({ transmission: 'automatic', sort: 'relevance' }),
    );
    expect(JSON.stringify(latest)).not.toMatch(/203\.0\.113|@example\.com|userId|lat|lng/);
    expect(Object.keys(latest as object).sort()).toEqual([
      'categoryId',
      'createdAt',
      'districtId',
      'endsOn',
      'filters',
      'id',
      'placeId',
      'resultCount',
      'startsOn',
    ]);
    const after = await overview();
    expect(after.supplyDemand.searches - before.supplyDemand.searches).toBe(3);
    expect(after.supplyDemand.zeroResultSearches - before.supplyDemand.zeroResultSearches).toBe(1);
    expect(
      after.supplyDemand.topZeroResultPlaces.find((p) => p.id === refs.gallePlaceId)?.count ?? 0,
    ).toBeGreaterThanOrEqual(1);
    expect(
      after.supplyDemand.topZeroResultCategories.find((c) => c.id === 'van')?.count ?? 0,
    ).toBeGreaterThanOrEqual(1);
  });

  it('reuses the Phase 8 provider metrics and exports stable, injection-safe UTF-8 CSV', async () => {
    const report = await api()
      .get('/api/v1/admin/reports/providers')
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(ProviderReportSchema.safeParse(report.body).success).toBe(true);
    const row = report.body.data.find(
      (r: { providerId: string }) => r.providerId === provider.providerId,
    );
    const metrics = (
      await api()
        .get('/api/v1/providers/me/metrics')
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body;
    expect(row.metrics).toEqual(metrics);
    expect(row.listedVehicles).toBe(1);

    const csv = await api()
      .get('/api/v1/admin/reports/providers.csv')
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toContain('providers.csv');
    const text = csv.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'providerId,displayName,status,listedVehicles,completedBookings,acceptanceRatePercent,accepted,decided,responseMinutes,responseSample,ratingAverage,ratingCount',
    );
    const mine = lines.find((l) => l.startsWith(provider.providerId)) as string;
    expect(mine).toContain(`"'=HYPERLINK(""http://evil"") Rentals මාතර"`);
    expect(mine).not.toMatch(/,=HYPERLINK/);
    expect(text).not.toMatch(/documents\/|@example\.com|secret|md5sig/);
    const overviewCsv = await api()
      .get('/api/v1/admin/reports/overview.csv')
      .query({ from: today, to: today })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(overviewCsv.text.slice(1).split('\r\n')[0]).toBe('section,metric,value');
    expect(overviewCsv.text).toContain('funnel,requested,');
    const zero = await api()
      .get('/api/v1/admin/reports/zero-result-searches.csv')
      .query({ from: today, to: today })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(zero.text.slice(1).split('\r\n')[0]).toBe(
      'place,district,category,startsOn,endsOn,searches',
    );
    expect(zero.text).toContain('Galle');
    await api()
      .get('/api/v1/admin/reports/providers.csv')
      .set(auth(customer.body.accessToken))
      .expect(403);
  });

  it('serves a read-only, secret-free audit viewer with filters and keyset pagination', async () => {
    // Make sure there is something to page through for this admin.
    await api()
      .post(`/api/v1/admin/providers/${provider.providerId}/suspend`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Audit viewer fixture' })
      .expect(200);
    await api()
      .post(`/api/v1/admin/providers/${provider.providerId}/reactivate`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(200);
    const page = await api()
      .get('/api/v1/admin/audit-events')
      .query({ actorUserId: admin.userId, limit: 1 })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AuditEventListSchema.safeParse(page.body).success).toBe(true);
    const first = page.body as AuditEventList;
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect(first.data[0]?.actor).toMatchObject({ id: admin.userId, email: admin.email });
    const second = (
      await api()
        .get('/api/v1/admin/audit-events')
        .query({ actorUserId: admin.userId, limit: 1, cursor: first.nextCursor })
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body as AuditEventList;
    expect(second.data[0]?.id).not.toBe(first.data[0]?.id);
    const byPrefix = (
      await api()
        .get('/api/v1/admin/audit-events')
        .query({ action: 'provider_profile.', targetId: provider.providerId })
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body as AuditEventList;
    expect(byPrefix.data.map((e) => e.action)).toEqual(
      expect.arrayContaining(['provider_profile.suspended', 'provider_profile.reactivated']),
    );
    expect(byPrefix.data.find((e) => e.action === 'provider_profile.suspended')?.reason).toBe(
      'Audit viewer fixture',
    );
    const exact = (
      await api()
        .get('/api/v1/admin/audit-events')
        .query({
          action: 'provider_profile.suspended',
          targetType: 'provider_profile',
          from: `${today}T00:00:00+05:30`,
        })
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body as AuditEventList;
    expect(exact.data.every((e) => e.action === 'provider_profile.suspended')).toBe(true);
    const everything = JSON.stringify(
      (
        await api()
          .get('/api/v1/admin/audit-events')
          .query({ limit: 50 })
          .set(auth(admin.body.accessToken))
          .expect(200)
      ).body,
    );
    expect(everything).not.toMatch(
      /passwordHash|password_hash|tokenHash|md5sig|merchantSecret|"secret"|"hash"|\$argon2|"ip"/,
    );
    await api()
      .post('/api/v1/admin/audit-events')
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(404);
    await api().get('/api/v1/admin/audit-events').set(auth(customer.body.accessToken)).expect(403);
    await api()
      .get('/api/v1/admin/audit-events')
      .query({ action: 'DROP TABLE' })
      .set(auth(admin.body.accessToken))
      .expect(400);
  });

  it('answers the operations overview with safe counts and queue links', async () => {
    const res = await api()
      .get('/api/v1/admin/overview')
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminOverviewSchema.safeParse(res.body).success).toBe(true);
    const items = (res.body as AdminOverview).items;
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'provider_applications',
        'vehicles_awaiting_review',
        'documents_pending',
        'disputes_open',
        'payments_attention',
        'refunds_due',
        'accepted_awaiting_payment',
        'pickups_today',
        'hidden_reviews',
      ]),
    );
    expect(items.every((i) => i.linkPath.startsWith('/admin'))).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|Nimal/);
    await api().get('/api/v1/admin/overview').set(auth(provider.body.accessToken)).expect(403);
  });
});
