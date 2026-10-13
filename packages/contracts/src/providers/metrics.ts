import { z } from 'zod';

import { RatingSummarySchema } from '../reviews/review';

/**
 * Provider trust metrics (Phase 8, TECH_DECISIONS D59), computed from booking
 * history by indexed SQL on read. Safe aggregates only: no customer, booking,
 * payment or revenue details. Percentages are suppressed (`null`) below the
 * minimum sample so a single request cannot show as "0 %" or "100 %".
 *
 * Formulas:
 * - `completedBookings`: bookings in status `completed`.
 * - `acceptance.decided`: requests the provider decided or let expire —
 *   accepted (ever reached `accepted`, i.e. `accepted_at` set), declined by
 *   the provider (manual declines; the automatic `vehicle_no_longer_available`
 *   decline is excluded because it is a consequence of accepting another
 *   request) and requests that expired unanswered.
 * - `acceptance.ratePercent`: `round(100 * accepted / decided)` when `decided ≥ minimumSample`.
 * - `responseTime.averageMinutes`: mean of `(accepted_at or declined_at) − created_at`
 *   over manual decisions, when `sample ≥ minimumSample`.
 */
export const PROVIDER_METRICS_MIN_SAMPLE = 3;

export const ProviderMetricsSchema = z.object({
  completedBookings: z.number().int().min(0),
  acceptance: z.object({
    ratePercent: z.number().int().min(0).max(100).nullable(),
    accepted: z.number().int().min(0),
    decided: z.number().int().min(0),
  }),
  responseTime: z.object({
    averageMinutes: z.number().int().min(0).nullable(),
    sample: z.number().int().min(0),
  }),
  rating: RatingSummarySchema,
  minimumSample: z.number().int().min(1),
});
export type ProviderMetrics = z.infer<typeof ProviderMetricsSchema>;
