import { EMPTY_RATING_SUMMARY, type RatingSummary } from '@vrp/contracts';
import { reviews, type DatabaseExecutor } from '@vrp/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';

/**
 * Rating aggregates over published reviews, computed by indexed SQL on read
 * (TECH_DECISIONS D57: no stored counters to keep consistent; the partial
 * indexes `reviews_vehicle_published_idx` / `reviews_provider_published_idx`
 * make the correlated subqueries cheap at validation scale). The average is
 * rounded once in PostgreSQL (`round(avg()::numeric, 1)`) and carried as a
 * string, so no floating-point arithmetic touches it.
 */
export type RatingScope = 'vehicle_id' | 'provider_id';

/** Correlated subquery fragment for a select list: average as text or null. */
export function ratingAverageSql(scope: RatingScope, idExpr: SQL): SQL<string | null> {
  return sql<
    string | null
  >`(select round(avg(r.overall_rating)::numeric, 1)::text from reviews r where r.${sql.raw(scope)} = ${idExpr} and r.status = 'published')`;
}

/** Correlated subquery fragment for a select list: number of published reviews. */
export function ratingCountSql(scope: RatingScope, idExpr: SQL): SQL<number> {
  return sql<number>`(select count(*)::int from reviews r where r.${sql.raw(scope)} = ${idExpr} and r.status = 'published')`;
}

export function toRatingSummary(average: string | null, count: number): RatingSummary {
  return count > 0 && average !== null ? { average, count } : EMPTY_RATING_SUMMARY;
}

/** Standalone aggregate for one vehicle or provider. */
export async function ratingSummaryFor(
  executor: DatabaseExecutor,
  scope: RatingScope,
  id: string,
): Promise<RatingSummary> {
  const column = scope === 'vehicle_id' ? reviews.vehicleId : reviews.providerId;
  const [row] = await executor
    .select({
      average: sql<string | null>`round(avg(${reviews.overallRating})::numeric, 1)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(eq(column, id), eq(reviews.status, 'published')));
  return toRatingSummary(row?.average ?? null, row?.count ?? 0);
}
