import { Inject, Injectable } from '@nestjs/common';
import {
  BookingStatusSchema,
  normalizeAmount,
  subtractAmounts,
  type BookingStatus,
  type NamedCount,
  type ProviderReport,
  type ReportQuery,
  type ReportsOverview,
} from '@vrp/contracts';
import {
  bookings,
  disputes,
  paymentEvents,
  payments,
  places,
  providerLocations,
  providerProfiles,
  searchLogs,
  vehicleCategories,
  vehicles,
  verificationDocuments,
  type Database,
} from '@vrp/database';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module';
import { searchableCondition } from '../discovery/searchable';
import { addDays, colomboDay } from '../documents/document.verification';
import { ProviderMetricsService } from '../providers/provider-metrics.service';
import { toCsv } from './csv';

const TOP = 10;

/** Inclusive Colombo calendar days → half-open UTC instant range. */
export function colomboRange(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00+05:30`),
    end: new Date(`${addDays(to, 1)}T00:00:00+05:30`),
  };
}

/**
 * Operational reports (Phase 9, PRD FR-AD7; TECH_DECISIONS D66): indexed SQL
 * on the live tables, computed on read. Money is summed by PostgreSQL and
 * carried as decimal strings; the funnel counts lifecycle timestamps so a
 * booking counts once per stage it reached. Provider metrics reuse the
 * Phase 8 service, never a second formula. Refunds are summed from the
 * `payment.refund_recorded` events (one per movement), never from the
 * cumulative `payments.refunded_amount`.
 */
@Injectable()
export class AdminReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly providerMetrics: ProviderMetricsService,
  ) {}

  async overview(query: ReportQuery, now = new Date()): Promise<ReportsOverview> {
    const { start, end } = colomboRange(query.from, query.to);
    const inRange = and(gte(bookings.createdAt, start), lt(bookings.createdAt, end));
    const today = colomboDay(now);

    const [funnelRow] = await this.db
      .select({
        requested: sql<number>`count(*)::int`,
        accepted: sql<number>`count(*) filter (where ${bookings.acceptedAt} is not null)::int`,
        confirmed: sql<number>`count(*) filter (where ${bookings.confirmedAt} is not null)::int`,
        active: sql<number>`count(*) filter (where ${bookings.pickedUpAt} is not null)::int`,
        completed: sql<number>`count(*) filter (where ${bookings.completedAt} is not null)::int`,
        confirmedGmv: sql<string>`coalesce(sum(${bookings.subtotalAmount}) filter (where ${bookings.confirmedAt} is not null), 0)::text`,
        completedGmv: sql<string>`coalesce(sum(${bookings.subtotalAmount}) filter (where ${bookings.status} = 'completed'), 0)::text`,
        completedCount: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`,
      })
      .from(bookings)
      .where(inRange);

    const statusRows = await this.db
      .select({ status: bookings.status, count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(inRange)
      .groupBy(bookings.status);
    const statusCounts = Object.fromEntries(
      BookingStatusSchema.options.map((s) => [s, 0]),
    ) as Record<BookingStatus, number>;
    for (const row of statusRows) statusCounts[row.status] = row.count;

    const [moneyRange] = await this.db
      .select({
        advances: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} in ('paid', 'refunded') and ${payments.paidAt} >= ${start.toISOString()}::timestamptz and ${payments.paidAt} < ${end.toISOString()}::timestamptz), 0)::text`,
        advancesCount: sql<number>`count(*) filter (where ${payments.status} in ('paid', 'refunded') and ${payments.paidAt} >= ${start.toISOString()}::timestamptz and ${payments.paidAt} < ${end.toISOString()}::timestamptz)::int`,
        refundDue: sql<string>`coalesce(sum(${payments.refundDueAmount}) filter (where ${payments.status} = 'paid' and ${payments.refundDueAmount} > 0), 0)::text`,
        refundDueCount: sql<number>`count(*) filter (where ${payments.status} = 'paid' and ${payments.refundDueAmount} > 0)::int`,
        anomaliesOpen: sql<number>`count(*) filter (where ${payments.requiresManualResolution} = true)::int`,
      })
      .from(payments);
    // Refunds are counted per recorded movement (D66): `payments.refunded_amount` is the
    // cumulative total and `refunded_at` only remembers the latest one, so each partial
    // refund is reported in the period it was recorded, from the append-only event history.
    const [refundRange] = await this.db
      .select({
        refunded: sql<string>`coalesce(sum((${paymentEvents.metadata} ->> 'amount')::numeric), 0)::text`,
        refundsCount: sql<number>`count(*)::int`,
      })
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.action, 'payment.refund_recorded'),
          gte(paymentEvents.createdAt, start),
          lt(paymentEvents.createdAt, end),
        ),
      );

    const bookingsByPlace = await this.db
      .select({ id: places.id, name: places.name, count: sql<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(providerLocations, eq(providerLocations.id, bookings.locationId))
      .innerJoin(places, eq(places.id, providerLocations.placeId))
      .where(inRange)
      .groupBy(places.id, places.name)
      .orderBy(desc(sql`count(*)`), asc(places.name))
      .limit(TOP);
    const bookingsByCategory = await this.db
      .select({
        id: vehicleCategories.id,
        name: vehicleCategories.name,
        count: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .innerJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(inRange)
      .groupBy(vehicleCategories.id, vehicleCategories.name)
      .orderBy(desc(sql`count(*)`), asc(vehicleCategories.name))
      .limit(TOP);

    const searchRange = and(gte(searchLogs.createdAt, start), lt(searchLogs.createdAt, end));
    const [searchTotals] = await this.db
      .select({
        searches: sql<number>`count(*)::int`,
        zero: sql<number>`count(*) filter (where ${searchLogs.resultCount} = 0)::int`,
      })
      .from(searchLogs)
      .where(searchRange);
    const topZeroResultPlaces = await this.db
      .select({ id: places.id, name: places.name, count: sql<number>`count(*)::int` })
      .from(searchLogs)
      .innerJoin(places, eq(places.id, searchLogs.placeId))
      .where(and(searchRange, eq(searchLogs.resultCount, 0)))
      .groupBy(places.id, places.name)
      .orderBy(desc(sql`count(*)`), asc(places.name))
      .limit(TOP);
    const topZeroResultCategories = await this.db
      .select({
        id: vehicleCategories.id,
        name: vehicleCategories.name,
        count: sql<number>`count(*)::int`,
      })
      .from(searchLogs)
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, searchLogs.categoryId))
      .where(and(searchRange, eq(searchLogs.resultCount, 0)))
      .groupBy(vehicleCategories.id, vehicleCategories.name)
      .orderBy(desc(sql`count(*)`), asc(vehicleCategories.name))
      .limit(TOP);

    const [ops] = await this.db
      .select({
        requestExpiries: sql<number>`count(*) filter (where ${bookings.status} = 'expired' and ${bookings.acceptedAt} is null and ${bookings.expiredAt} >= ${start.toISOString()}::timestamptz and ${bookings.expiredAt} < ${end.toISOString()}::timestamptz)::int`,
        paymentExpiries: sql<number>`count(*) filter (where ${bookings.status} = 'expired' and ${bookings.acceptedAt} is not null and ${bookings.expiredAt} >= ${start.toISOString()}::timestamptz and ${bookings.expiredAt} < ${end.toISOString()}::timestamptz)::int`,
        customerCancellations: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled_by_customer' and ${bookings.cancelledAt} >= ${start.toISOString()}::timestamptz and ${bookings.cancelledAt} < ${end.toISOString()}::timestamptz)::int`,
        providerCancellations: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled_by_provider' and ${bookings.cancelledAt} >= ${start.toISOString()}::timestamptz and ${bookings.cancelledAt} < ${end.toISOString()}::timestamptz)::int`,
        platformCancellations: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled_by_platform' and ${bookings.cancelledAt} >= ${start.toISOString()}::timestamptz and ${bookings.cancelledAt} < ${end.toISOString()}::timestamptz)::int`,
        noShows: sql<number>`count(*) filter (where ${bookings.status} = 'no_show' and ${bookings.noShowAt} >= ${start.toISOString()}::timestamptz and ${bookings.noShowAt} < ${end.toISOString()}::timestamptz)::int`,
      })
      .from(bookings);
    const [disputeRow] = await this.db
      .select({ open: sql<number>`count(*)::int` })
      .from(disputes)
      .where(inArray(disputes.status, ['open', 'in_review']));
    const [docRow] = await this.db
      .select({
        expiringSoon: sql<number>`count(*) filter (where ${verificationDocuments.expiresOn} > ${today}::date and ${verificationDocuments.expiresOn} <= ${addDays(today, 30)}::date)::int`,
        expired: sql<number>`count(*) filter (where ${verificationDocuments.expiresOn} <= ${today}::date)::int`,
      })
      .from(verificationDocuments)
      .where(
        and(
          eq(verificationDocuments.status, 'approved'),
          isNull(verificationDocuments.supersededAt),
          isNotNull(verificationDocuments.expiresOn),
        ),
      );

    const advances = normalizeAmount(moneyRange?.advances ?? '0');
    const refunded = normalizeAmount(refundRange?.refunded ?? '0');
    return {
      range: { from: query.from, to: query.to },
      funnel: {
        requested: funnelRow?.requested ?? 0,
        accepted: funnelRow?.accepted ?? 0,
        confirmed: funnelRow?.confirmed ?? 0,
        active: funnelRow?.active ?? 0,
        completed: funnelRow?.completed ?? 0,
      },
      statusCounts,
      gmv: {
        confirmedGmv: normalizeAmount(funnelRow?.confirmedGmv ?? '0'),
        completedGmv: normalizeAmount(funnelRow?.completedGmv ?? '0'),
        confirmedCount: funnelRow?.confirmed ?? 0,
        completedCount: funnelRow?.completedCount ?? 0,
        currency: 'LKR',
      },
      money: {
        advancesCollected: advances,
        advancesCount: moneyRange?.advancesCount ?? 0,
        refundedAmount: refunded,
        refundsCount: refundRange?.refundsCount ?? 0,
        refundDueAmount: normalizeAmount(moneyRange?.refundDue ?? '0'),
        refundDueCount: moneyRange?.refundDueCount ?? 0,
        anomaliesOpen: moneyRange?.anomaliesOpen ?? 0,
        estimatedPlatformRevenue: subtractAmounts(advances, refunded),
        currency: 'LKR',
      },
      supplyDemand: {
        bookingsByPlace: bookingsByPlace.map(named),
        bookingsByCategory: bookingsByCategory.map(named),
        searches: searchTotals?.searches ?? 0,
        zeroResultSearches: searchTotals?.zero ?? 0,
        topZeroResultPlaces: topZeroResultPlaces.map(named),
        topZeroResultCategories: topZeroResultCategories.map(named),
      },
      operations: {
        requestExpiries: ops?.requestExpiries ?? 0,
        paymentExpiries: ops?.paymentExpiries ?? 0,
        customerCancellations: ops?.customerCancellations ?? 0,
        providerCancellations: ops?.providerCancellations ?? 0,
        platformCancellations: ops?.platformCancellations ?? 0,
        noShows: ops?.noShows ?? 0,
        openDisputes: disputeRow?.open ?? 0,
        refundDue: moneyRange?.refundDueCount ?? 0,
        paymentAnomalies: moneyRange?.anomaliesOpen ?? 0,
        documentsExpiringWithin30Days: docRow?.expiringSoon ?? 0,
        documentsExpired: docRow?.expired ?? 0,
      },
      generatedAt: now.toISOString(),
    };
  }

  async providers(now = new Date()): Promise<ProviderReport> {
    const rows = await this.db
      .select({
        id: providerProfiles.id,
        displayName: providerProfiles.displayName,
        status: providerProfiles.status,
      })
      .from(providerProfiles)
      .where(isNull(providerProfiles.deletedAt))
      .orderBy(asc(providerProfiles.displayName))
      .limit(500);
    // Listings that satisfy the public searchable predicate right now, per provider.
    const listed = new Map(
      (
        await this.db
          .select({ providerId: vehicles.providerId, count: sql<number>`count(*)::int` })
          .from(vehicles)
          .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
          .innerJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
          .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
          .where(searchableCondition())
          .groupBy(vehicles.providerId)
      ).map((r) => [r.providerId, r.count]),
    );
    const data = [];
    for (const row of rows) {
      data.push({
        providerId: row.id,
        displayName: row.displayName,
        status: row.status,
        listedVehicles: listed.get(row.id) ?? 0,
        metrics: await this.providerMetrics.metricsFor(row.id),
      });
    }
    return { data, generatedAt: now.toISOString() };
  }

  // ----------------------------------------------------------------- CSV

  async overviewCsv(query: ReportQuery): Promise<string> {
    const report = await this.overview(query);
    const rows: (string | number)[][] = [];
    const push = (section: string, metric: string, value: string | number) =>
      rows.push([section, metric, value]);
    for (const [k, v] of Object.entries(report.funnel)) push('funnel', k, v);
    for (const [k, v] of Object.entries(report.statusCounts)) push('status', k, v);
    push('gmv', 'confirmedGmv', report.gmv.confirmedGmv);
    push('gmv', 'completedGmv', report.gmv.completedGmv);
    push('gmv', 'confirmedCount', report.gmv.confirmedCount);
    push('gmv', 'completedCount', report.gmv.completedCount);
    for (const [k, v] of Object.entries(report.money))
      if (k !== 'currency') push('money', k, v as string | number);
    push('demand', 'searches', report.supplyDemand.searches);
    push('demand', 'zeroResultSearches', report.supplyDemand.zeroResultSearches);
    for (const p of report.supplyDemand.bookingsByPlace) push('bookingsByPlace', p.name, p.count);
    for (const c of report.supplyDemand.bookingsByCategory)
      push('bookingsByCategory', c.name, c.count);
    for (const p of report.supplyDemand.topZeroResultPlaces)
      push('zeroResultByPlace', p.name, p.count);
    for (const c of report.supplyDemand.topZeroResultCategories)
      push('zeroResultByCategory', c.name, c.count);
    for (const [k, v] of Object.entries(report.operations)) push('operations', k, v);
    return toCsv(['section', 'metric', 'value'], rows);
  }

  async providersCsv(): Promise<string> {
    const report = await this.providers();
    return toCsv(
      [
        'providerId',
        'displayName',
        'status',
        'listedVehicles',
        'completedBookings',
        'acceptanceRatePercent',
        'accepted',
        'decided',
        'responseMinutes',
        'responseSample',
        'ratingAverage',
        'ratingCount',
      ],
      report.data.map((r) => [
        r.providerId,
        r.displayName,
        r.status,
        r.listedVehicles,
        r.metrics.completedBookings,
        r.metrics.acceptance.ratePercent,
        r.metrics.acceptance.accepted,
        r.metrics.acceptance.decided,
        r.metrics.responseTime.averageMinutes,
        r.metrics.responseTime.sample,
        r.metrics.rating.average,
        r.metrics.rating.count,
      ]),
    );
  }

  async zeroResultSearchesCsv(query: ReportQuery): Promise<string> {
    const { start, end } = colomboRange(query.from, query.to);
    const rows = await this.db
      .select({
        placeName: places.name,
        districtId: searchLogs.districtId,
        categoryName: vehicleCategories.name,
        startsOn: searchLogs.startsOn,
        endsOn: searchLogs.endsOn,
        count: sql<number>`count(*)::int`,
      })
      .from(searchLogs)
      .leftJoin(places, eq(places.id, searchLogs.placeId))
      .leftJoin(vehicleCategories, eq(vehicleCategories.id, searchLogs.categoryId))
      .where(
        and(
          gte(searchLogs.createdAt, start),
          lt(searchLogs.createdAt, end),
          eq(searchLogs.resultCount, 0),
        ),
      )
      .groupBy(
        places.name,
        searchLogs.districtId,
        vehicleCategories.name,
        searchLogs.startsOn,
        searchLogs.endsOn,
      )
      .orderBy(desc(sql`count(*)`))
      .limit(1000);
    return toCsv(
      ['place', 'district', 'category', 'startsOn', 'endsOn', 'searches'],
      rows.map((r) => [r.placeName, r.districtId, r.categoryName, r.startsOn, r.endsOn, r.count]),
    );
  }
}

function named(row: { id: string; name: string; count: number }): NamedCount {
  return { id: row.id, name: row.name, count: row.count };
}
