'use client';

import {
  BookingStatusSchema,
  formatLkr,
  type NamedCount,
  type ProviderReport,
  type ReportCsvName,
  type ReportsOverview,
} from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { AdminShell, DetailRows } from '@/components/admin/admin-shell';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { RatingSummaryLine } from '@/components/reviews/rating-stars';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { colomboDayOffset } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { downloadBlob } from '@/lib/blob';
import { BOOKING_STATUS, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { PROVIDER_STATUS } from '@/lib/provider-labels';

export default function AdminReportsPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const [from, setFrom] = useState(() => colomboDayOffset(-30));
  const [to, setTo] = useState(() => colomboDayOffset(0));
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [providers, setProviders] = useState<ProviderReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<ReportCsvName | null>(null);

  const rangeValid = from !== '' && to !== '' && to >= from;

  useEffect(() => {
    if (!ready || !rangeValid) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.reportsOverview(t, { from, to }))
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, from, rangeValid, ready, to, withAccessToken]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.reportsProviders(t))
      .then((result) => {
        if (!cancelled) setProviders(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ready, withAccessToken]);

  const download = async (name: ReportCsvName) => {
    setDownloading(name);
    setError(null);
    try {
      const blob = await withAccessToken((t) =>
        api.admin.reportCsv(t, name, name === 'providers' ? undefined : { from, to }),
      );
      downloadBlob(blob, name === 'providers' ? 'providers.csv' : `${name}-${from}-to-${to}.csv`);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setDownloading(null);
    }
  };

  const current =
    overview && overview.range.from === from && overview.range.to === to ? overview : null;

  return (
    <AdminShell area={area} width="max-w-6xl">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Computed from the live tables when you open the page (no warehouse). Ranges are Colombo
          calendar days, inclusive. Money is in LKR.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-muted-foreground grid gap-1 text-xs">
          From
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          To
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(['overview', 'zero-result-searches', 'providers'] as const).map((name) => (
          <Button
            key={name}
            variant="outline"
            size="sm"
            disabled={downloading !== null || (name !== 'providers' && !rangeValid)}
            onClick={() => void download(name)}
          >
            {downloading === name ? 'Preparing…' : `Download ${name}.csv`}
          </Button>
        ))}
      </div>
      {!rangeValid ? (
        <FormMessage variant="destructive">
          Choose a range where “to” is not before “from”.
        </FormMessage>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}

      {!current ? (
        <p className="text-muted-foreground text-sm">Loading report…</p>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <AuthCard
              title="Booking funnel"
              description="Bookings requested in the range; one booking counts once per stage it reached."
            >
              <DetailRows
                rows={[
                  ['Requested', String(current.funnel.requested)],
                  ['Accepted', String(current.funnel.accepted)],
                  ['Confirmed (advance paid)', String(current.funnel.confirmed)],
                  ['Picked up', String(current.funnel.active)],
                  ['Completed', String(current.funnel.completed)],
                ]}
              />
            </AuthCard>
            <AuthCard title="Current status of those bookings">
              <DetailRows
                rows={BookingStatusSchema.options.map((status) => [
                  BOOKING_STATUS[status].label,
                  String(current.statusCounts[status] ?? 0),
                ])}
              />
            </AuthCard>
            <AuthCard title="Gross booking value" description="Snapshotted rental subtotals (LKR).">
              <DetailRows
                rows={[
                  [
                    'Confirmed',
                    `${formatLkr(current.gmv.confirmedGmv)} across ${current.gmv.confirmedCount} booking${current.gmv.confirmedCount === 1 ? '' : 's'}`,
                  ],
                  [
                    'Completed',
                    `${formatLkr(current.gmv.completedGmv)} across ${current.gmv.completedCount} booking${current.gmv.completedCount === 1 ? '' : 's'}`,
                  ],
                ]}
              />
            </AuthCard>
            <AuthCard
              title="Money"
              description="Verified online advances collected in the range and refund movements recorded in the range (each partial refund counts in the period it was recorded); refund-due and anomaly counts are current totals."
            >
              <DetailRows
                rows={[
                  [
                    'Advances collected',
                    `${formatLkr(current.money.advancesCollected)} (${current.money.advancesCount})`,
                  ],
                  [
                    'Refunds recorded',
                    `${formatLkr(current.money.refundedAmount)} (${current.money.refundsCount})`,
                  ],
                  [
                    'Refunds due now',
                    `${formatLkr(current.money.refundDueAmount)} (${current.money.refundDueCount})`,
                  ],
                  ['Payments needing attention', String(current.money.anomaliesOpen)],
                  [
                    'Estimated platform revenue',
                    <span key="rev">
                      {formatLkr(current.money.estimatedPlatformRevenue)}{' '}
                      <Badge variant="outline">estimate</Badge>
                      <span className="text-muted-foreground block text-xs">
                        Advances collected minus refunds recorded in the range (negative when
                        earlier advances are refunded). Under money model B the advance is the
                        commission; this is not recognised revenue.
                      </span>
                    </span>,
                  ],
                ]}
              />
            </AuthCard>
            <AuthCard
              title="Demand by place"
              description="Bookings requested in the range, by pickup place."
            >
              <NamedCountTable rows={current.supplyDemand.bookingsByPlace} />
            </AuthCard>
            <AuthCard title="Demand by category">
              <NamedCountTable rows={current.supplyDemand.bookingsByCategory} />
            </AuthCard>
            <AuthCard
              title="Searches without results"
              description={`${current.supplyDemand.zeroResultSearches} of ${current.supplyDemand.searches} searches in the range returned nothing.`}
            >
              <p className="text-muted-foreground mb-1 text-xs">Places</p>
              <NamedCountTable rows={current.supplyDemand.topZeroResultPlaces} />
              <p className="text-muted-foreground mt-3 mb-1 text-xs">Categories</p>
              <NamedCountTable rows={current.supplyDemand.topZeroResultCategories} />
            </AuthCard>
            <AuthCard title="Operations" description="Range-bound unless marked current.">
              <DetailRows
                rows={[
                  ['Requests expired unanswered', String(current.operations.requestExpiries)],
                  ['Accepted but unpaid (expired)', String(current.operations.paymentExpiries)],
                  ['Customer cancellations', String(current.operations.customerCancellations)],
                  ['Provider cancellations', String(current.operations.providerCancellations)],
                  ['Platform cancellations', String(current.operations.platformCancellations)],
                  ['No-shows', String(current.operations.noShows)],
                  ['Open disputes (current)', String(current.operations.openDisputes)],
                  ['Refunds due (current)', String(current.operations.refundDue)],
                  ['Payment anomalies (current)', String(current.operations.paymentAnomalies)],
                  [
                    'Documents expiring ≤ 30 days (current)',
                    String(current.operations.documentsExpiringWithin30Days),
                  ],
                  ['Documents expired (current)', String(current.operations.documentsExpired)],
                ]}
              />
            </AuthCard>
          </div>
          <p className="text-muted-foreground text-xs">
            Generated {formatDateTime(current.generatedAt)} for {current.range.from} →{' '}
            {current.range.to}.
          </p>
        </>
      )}

      <AuthCard
        title="Provider metrics"
        description="Same formulas as the public trust metrics (minimum sample 3; automatic declines excluded). No ranking or penalties."
      >
        {!providers ? (
          <p className="text-muted-foreground text-sm">Loading providers…</p>
        ) : providers.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No approved providers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 font-medium">Provider</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Listed</th>
                  <th className="p-2 font-medium">Completed</th>
                  <th className="p-2 font-medium">Acceptance</th>
                  <th className="p-2 font-medium">Response</th>
                  <th className="p-2 font-medium">Rating</th>
                </tr>
              </thead>
              <tbody>
                {providers.data.map((row) => (
                  <tr key={row.providerId} className="border-t">
                    <td className="p-2">{row.displayName}</td>
                    <td className="p-2">
                      <Badge variant={PROVIDER_STATUS[row.status].tone}>
                        {row.status === 'active' ? 'Active' : 'Suspended'}
                      </Badge>
                    </td>
                    <td className="p-2">{row.listedVehicles}</td>
                    <td className="p-2">{row.metrics.completedBookings}</td>
                    <td className="p-2">
                      {row.metrics.acceptance.ratePercent === null
                        ? `${row.metrics.acceptance.accepted}/${row.metrics.acceptance.decided} (below sample)`
                        : `${row.metrics.acceptance.ratePercent}% of ${row.metrics.acceptance.decided}`}
                    </td>
                    <td className="p-2">
                      {row.metrics.responseTime.averageMinutes === null
                        ? `${row.metrics.responseTime.sample} sample${row.metrics.responseTime.sample === 1 ? '' : 's'}`
                        : `${row.metrics.responseTime.averageMinutes} min`}
                    </td>
                    <td className="p-2">
                      <RatingSummaryLine summary={row.metrics.rating} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-2 text-xs">
              Generated {formatDateTime(providers.generatedAt)}.
            </p>
          </div>
        )}
      </AuthCard>
    </AdminShell>
  );
}

function NamedCountTable({ rows }: { rows: NamedCount[] }) {
  if (rows.length === 0)
    return <p className="text-muted-foreground text-sm">None in this range.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t first:border-0">
            <td className="py-1">{row.name}</td>
            <td className="py-1 text-right font-medium">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
