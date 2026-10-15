'use client';

import { DisputeStatusSchema, type AdminDisputeSummary, type DisputeStatus } from '@vrp/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DISPUTE_REASON_LABEL, DISPUTE_STATUS } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { BOOKING_STATUS, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function AdminDisputesPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl px-4 py-12">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <AdminDisputesList />
    </Suspense>
  );
}

function AdminDisputesList() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const searchParams = useSearchParams();
  const initialStatus = DisputeStatusSchema.safeParse(searchParams.get('status'));
  const [status, setStatus] = useState<DisputeStatus | ''>(
    initialStatus.success ? initialStatus.data : 'open',
  );
  const [rows, setRows] = useState<AdminDisputeSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          api.admin.listDisputes(t, { status: status || undefined, cursor, limit: 30 }),
        );
        setRows((current) => (cursor ? [...current, ...page.data] : page.data));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(submitErrorFrom(caught).message);
      } finally {
        setLoading(false);
      }
    },
    [api, status, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  return (
    <AdminShell area={area}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Disputes</h1>
        <p className="text-muted-foreground text-sm">
          One dispute per booking, opened by a participant after the rental. Decisions are recorded
          with a public note; a refund recommendation is acted on under Payments, never
          automatically.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as DisputeStatus | '')}
        >
          <option value="">All statuses</option>
          {DisputeStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {DISPUTE_STATUS[s].label}
            </option>
          ))}
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Booking</th>
              <th className="p-3 font-medium">Parties</th>
              <th className="p-3 font-medium">Opened by</th>
              <th className="p-3 font-medium">Reason</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Messages</th>
              <th className="p-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  <Link
                    href={`/admin/disputes/${row.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {row.bookingReference}
                  </Link>
                  <br />
                  <span className="text-muted-foreground text-xs">
                    {row.vehicleTitle} · {BOOKING_STATUS[row.bookingStatus].label}
                  </span>
                </td>
                <td className="p-3">
                  {row.customerName}
                  <br />
                  <span className="text-muted-foreground text-xs">{row.providerDisplayName}</span>
                </td>
                <td className="p-3">{row.openedBy}</td>
                <td className="p-3">{DISPUTE_REASON_LABEL[row.reasonCode]}</td>
                <td className="p-3">
                  <Badge variant={DISPUTE_STATUS[row.status].tone}>
                    {DISPUTE_STATUS[row.status].label}
                  </Badge>
                </td>
                <td className="p-3">{row.messageCount}</td>
                <td className="p-3">{formatDateTime(row.updatedAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={7}>
                  No disputes match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {nextCursor ? (
        <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </Button>
      ) : null}
    </AdminShell>
  );
}
