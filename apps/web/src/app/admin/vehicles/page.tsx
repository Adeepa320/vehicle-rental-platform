'use client';

import { formatLkr, type AdminVehicleSummary, type VehicleStatus } from '@vrp/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { submitErrorFrom } from '@/lib/forms';
import { formatDate } from '@/lib/provider-labels';
import { VEHICLE_STATUS, vehicleTitle } from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

export default function AdminVehiclesPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;
  const [status, setStatus] = useState<VehicleStatus | ''>('submitted');
  const [rows, setRows] = useState<AdminVehicleSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((token) =>
          api.admin.listVehicles(token, { status: status || undefined, cursor, limit: 20 }),
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
    if (gate !== 'ready' || !isAdmin) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [gate, isAdmin, load]);

  if (gate !== 'ready') {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }
  if (!isAdmin) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <AdminNav />
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium">Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Vehicle review</h1>
        <p className="text-muted-foreground text-sm">
          Check the details with the provider (plate, pricing, pickup location) before approving. No
          photos or documents are collected in this phase.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="statusFilter">
          Status
        </label>
        <select
          id="statusFilter"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as VehicleStatus | '')}
        >
          <option value="">All</option>
          {(Object.keys(VEHICLE_STATUS) as VehicleStatus[]).map((s) => (
            <option key={s} value={s}>
              {VEHICLE_STATUS[s].label}
            </option>
          ))}
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Vehicle</th>
              <th className="p-3 font-medium">Provider</th>
              <th className="p-3 font-medium">Plate</th>
              <th className="p-3 font-medium">Daily rate</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Submitted</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">{vehicleTitle(row, '(untitled)')}</td>
                <td className="p-3">{row.provider.displayName}</td>
                <td className="p-3">{row.registrationNumber ?? '—'}</td>
                <td className="p-3">{formatLkr(row.dailyRate)}</td>
                <td className="p-3">
                  <Badge variant={VEHICLE_STATUS[row.status].tone}>
                    {VEHICLE_STATUS[row.status].label}
                  </Badge>
                </td>
                <td className="p-3">{formatDate(row.submittedAt)}</td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/admin/vehicles/${row.id}`} />}
                  >
                    Review
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={7}>
                  No vehicles match this filter.
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
    </main>
  );
}
