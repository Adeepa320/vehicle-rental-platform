import { Inject, Injectable } from '@nestjs/common';
import { PROVIDER_METRICS_MIN_SAMPLE, type ProviderMetrics } from '@vrp/contracts';
import { bookings, type Database, type DatabaseExecutor } from '@vrp/database';
import { eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module';
import { ratingSummaryFor } from '../reviews/rating.aggregates';

/**
 * Provider trust metrics from booking history (Phase 8, TECH_DECISIONS D59),
 * computed by one indexed aggregate query on read — no stored counters, no
 * job, no staleness. Formulas are documented on `ProviderMetricsSchema`;
 * only safe aggregates leave this service (never customer, booking or
 * payment details), and percentages are suppressed below the minimum sample.
 */
@Injectable()
export class ProviderMetricsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async metricsFor(
    providerId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProviderMetrics> {
    const manualDecision = sql`(${bookings.acceptedAt} is not null or (${bookings.status} = 'declined' and ${bookings.declineReason} <> 'vehicle_no_longer_available'))`;
    const [row] = await executor
      .select({
        completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`,
        accepted: sql<number>`count(*) filter (where ${bookings.acceptedAt} is not null)::int`,
        declinedManually: sql<number>`count(*) filter (where ${bookings.status} = 'declined' and ${bookings.declineReason} <> 'vehicle_no_longer_available')::int`,
        expiredUnanswered: sql<number>`count(*) filter (where ${bookings.status} = 'expired' and ${bookings.acceptedAt} is null)::int`,
        responseSample: sql<number>`count(*) filter (where ${manualDecision})::int`,
        responseSeconds: sql<
          number | null
        >`(avg(extract(epoch from (coalesce(${bookings.acceptedAt}, ${bookings.declinedAt}) - ${bookings.createdAt}))) filter (where ${manualDecision}))::float8`,
      })
      .from(bookings)
      .where(eq(bookings.providerId, providerId));
    const rating = await ratingSummaryFor(executor, 'provider_id', providerId);
    const accepted = row?.accepted ?? 0;
    const decided = accepted + (row?.declinedManually ?? 0) + (row?.expiredUnanswered ?? 0);
    const responseSample = row?.responseSample ?? 0;
    const responseSeconds = row?.responseSeconds ?? null;
    return {
      completedBookings: row?.completed ?? 0,
      acceptance: {
        ratePercent:
          decided >= PROVIDER_METRICS_MIN_SAMPLE ? Math.round((100 * accepted) / decided) : null,
        accepted,
        decided,
      },
      responseTime: {
        averageMinutes:
          responseSample >= PROVIDER_METRICS_MIN_SAMPLE && responseSeconds !== null
            ? Math.max(0, Math.round(Number(responseSeconds) / 60))
            : null,
        sample: responseSample,
      },
      rating,
      minimumSample: PROVIDER_METRICS_MIN_SAMPLE,
    };
  }
}
