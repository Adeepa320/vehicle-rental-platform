import type { ProviderMetrics } from '@vrp/contracts';

import { RatingSummaryLine } from '@/components/reviews/rating-stars';

/**
 * Safe aggregate trust signals (TECH_DECISIONS D59). Percentages are only
 * shown once the sample is large enough; otherwise the count is stated so a
 * single request never reads as "100 %" or "0 %".
 */
export function ProviderMetricsList({
  metrics,
  compact = false,
}: {
  metrics: ProviderMetrics;
  compact?: boolean;
}) {
  const { acceptance, responseTime } = metrics;
  const rows: [string, string][] = [
    ['Completed rentals', String(metrics.completedBookings)],
    [
      'Acceptance rate',
      acceptance.ratePercent === null
        ? acceptance.decided === 0
          ? 'No requests yet'
          : `${acceptance.accepted} of ${acceptance.decided} request${acceptance.decided === 1 ? '' : 's'} accepted`
        : `${acceptance.ratePercent}% (${acceptance.decided} requests)`,
    ],
    [
      'Typical response time',
      responseTime.averageMinutes === null
        ? responseTime.sample === 0
          ? 'No responses yet'
          : `Based on ${responseTime.sample} response${responseTime.sample === 1 ? '' : 's'} so far`
        : formatMinutes(responseTime.averageMinutes),
    ],
  ];
  return (
    <div className={`grid gap-1 ${compact ? 'text-xs' : 'text-sm'}`}>
      <p>
        <RatingSummaryLine summary={metrics.rating} />
      </p>
      {rows.map(([label, value]) => (
        <p key={label}>
          <span className="text-muted-foreground">{label}:</span> {value}
        </p>
      ))}
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `about ${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} hour${hours === 1 ? '' : 's'}`;
  return `about ${Math.round(hours / 24)} days`;
}
