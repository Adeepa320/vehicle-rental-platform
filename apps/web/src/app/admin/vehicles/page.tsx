'use client';

import { formatLkr, type AdminVehicleSummary, type VehicleStatus } from '@vrp/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { submitErrorFrom } from '@/lib/forms';
import { formatDate } from '@/lib/provider-labels';
import { categoryName, useReferenceData } from '@/lib/reference';
import { VEHICLE_STATUS, vehicleTitle } from '@/lib/vehicle-labels';

export default function AdminVehiclesPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl px-4 py-12">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <AdminVehiclesList />
    </Suspense>
  );
}

function AdminVehiclesList() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const reference = useReferenceData();
  const searchParams = useSearchParams();
  const providerId = searchParams.get('providerId') ?? undefined;
  const [status, setStatus] = useState<VehicleStatus | ''>(providerId ? '' : 'submitted');
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminVehicleSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = q.trim();
  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((token) =>
          api.admin.listVehicles(token, {
            status: status || undefined,
            categoryId: categoryId || undefined,
            q: search.length >= 2 ? search : undefined,
            providerId,
            cursor,
            limit: 20,
          }),
        );
        setRows((current) => (cursor ? [...current, ...page.data] : page.data));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(submitErrorFrom(caught).message);
      } finally {
        setLoading(false);
      }
    },
    [api, categoryId, providerId, search, status, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  const ref = reference.status === 'ready' ? reference.data : undefined;

  return (
    <AdminShell area={area}>
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium">Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Vehicle review</h1>
        <p className="text-muted-foreground text-sm">
          Check the details with the provider (plate, pricing, pickup location) before approving.
          Vehicle documents are reviewed under Documents and shown on each listing.
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
        <select
          className={selectClass}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {(ref?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input
          className="w-64"
          placeholder="Title, make, plate or provider (2+ chars)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {providerId ? (
        <p className="text-muted-foreground text-xs">
          Showing the selected provider’s listings only.{' '}
          <Link href="/admin/vehicles" className="underline underline-offset-4">
            Show all
          </Link>
        </p>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Vehicle</th>
              <th className="p-3 font-medium">Category</th>
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
                <td className="p-3">{categoryName(ref, row.categoryId)}</td>
                <td className="p-3">
                  <Link
                    href={`/admin/providers/${row.provider.id}`}
                    className="underline underline-offset-4"
                  >
                    {row.provider.displayName}
                  </Link>
                </td>
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
                    Open
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={8}>
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
    </AdminShell>
  );
}
