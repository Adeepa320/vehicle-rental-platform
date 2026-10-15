import { z } from 'zod';

import { BookingStatusSchema } from '../bookings/booking';
import { LkrAmountSchema, SignedLkrAmountSchema } from '../common/money';
import { ProviderMetricsSchema } from '../providers/metrics';

/**
 * Operational reports (Phase 9, PRD FR-AD7), computed by indexed SQL on read
 * over the live tables — no warehouse, no materialised views. Money values are
 * decimal strings summed in PostgreSQL. Formulas are documented on each field
 * and in API_DESIGN §13.
 */
export const ReportQuerySchema = z
  .object({
    /** Inclusive Colombo calendar day. */
    from: z.iso.date(),
    /** Inclusive Colombo calendar day. */
    to: z.iso.date(),
  })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'to must not be before from' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 400, {
    path: ['to'],
    message: 'at most 400 days',
  });
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

const Count = z.number().int().min(0);

/**
 * Lifecycle progression of the bookings **requested in the range**: how many
 * ever reached each stage (`accepted_at`, `confirmed_at`, `picked_up_at`,
 * `completed_at` set), so one booking counts once per stage it passed.
 */
export const BookingFunnelSchema = z.object({
  requested: Count,
  accepted: Count,
  confirmed: Count,
  active: Count,
  completed: Count,
});
export type BookingFunnel = z.infer<typeof BookingFunnelSchema>;

export const NamedCountSchema = z.object({ id: z.string(), name: z.string(), count: Count });
export type NamedCount = z.infer<typeof NamedCountSchema>;

export const ReportsOverviewSchema = z.object({
  range: z.object({ from: z.iso.date(), to: z.iso.date() }),
  funnel: BookingFunnelSchema,
  /** Current status of the bookings requested in the range. */
  statusCounts: z.record(BookingStatusSchema, Count),
  gmv: z.object({
    /** Sum of the snapshotted rental subtotal of bookings requested in the range that reached `confirmed`. */
    confirmedGmv: LkrAmountSchema,
    /** Sum of the snapshotted rental subtotal of bookings requested in the range that are `completed`. */
    completedGmv: LkrAmountSchema,
    confirmedCount: Count,
    completedCount: Count,
    currency: z.literal('LKR'),
  }),
  money: z.object({
    /** Sum of verified successful advances (`paid` / `refunded` rows) with `paid_at` in the range. */
    advancesCollected: LkrAmountSchema,
    advancesCount: Count,
    /**
     * Sum of the individual refund movements recorded in the range: `payment_events`
     * rows with action `payment.refund_recorded` by event `created_at`, each carrying
     * its own `metadata.amount`. Never the cumulative `payments.refunded_amount`,
     * whose `refunded_at` only remembers the latest partial refund (D66).
     */
    refundedAmount: LkrAmountSchema,
    /** Number of refund movements recorded in the range (a partial refund counts once). */
    refundsCount: Count,
    /** Currently owed back to customers (all time): paid rows with `refund_due_amount > 0`. */
    refundDueAmount: LkrAmountSchema,
    refundDueCount: Count,
    /** Payments currently flagged for manual resolution (all time). */
    anomaliesOpen: Count,
    /**
     * `advancesCollected − refundedAmount` for the range; negative when refunds of
     * earlier advances are recorded in it. Under money model B the advance is the
     * commission; this is an estimate, not recognised revenue.
     */
    estimatedPlatformRevenue: SignedLkrAmountSchema,
    currency: z.literal('LKR'),
  }),
  supplyDemand: z.object({
    bookingsByPlace: z.array(NamedCountSchema),
    bookingsByCategory: z.array(NamedCountSchema),
    searches: Count,
    zeroResultSearches: Count,
    topZeroResultPlaces: z.array(NamedCountSchema),
    topZeroResultCategories: z.array(NamedCountSchema),
  }),
  operations: z.object({
    /** Requests that expired unanswered (`expired_at` in range, never accepted). */
    requestExpiries: Count,
    /** Accepted bookings that expired unpaid (`expired_at` in range, `accepted_at` set). */
    paymentExpiries: Count,
    customerCancellations: Count,
    providerCancellations: Count,
    platformCancellations: Count,
    noShows: Count,
    /** Current counts (not range-bound). */
    openDisputes: Count,
    refundDue: Count,
    paymentAnomalies: Count,
    documentsExpiringWithin30Days: Count,
    documentsExpired: Count,
  }),
  generatedAt: z.iso.datetime(),
});
export type ReportsOverview = z.infer<typeof ReportsOverviewSchema>;

/** One row per approved provider; metrics reuse the Phase 8 formulas unchanged. */
export const ProviderReportRowSchema = z.object({
  providerId: z.uuid(),
  displayName: z.string(),
  status: z.enum(['active', 'suspended']),
  listedVehicles: Count,
  metrics: ProviderMetricsSchema,
});
export type ProviderReportRow = z.infer<typeof ProviderReportRowSchema>;

export const ProviderReportSchema = z.object({
  data: z.array(ProviderReportRowSchema),
  generatedAt: z.iso.datetime(),
});
export type ProviderReport = z.infer<typeof ProviderReportSchema>;

/** CSV exports offered by `/admin/reports/*.csv`; nothing else can be exported. */
export const REPORT_CSV_NAMES = ['overview', 'providers', 'zero-result-searches'] as const;
export type ReportCsvName = (typeof REPORT_CSV_NAMES)[number];
