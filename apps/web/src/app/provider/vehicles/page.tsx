'use client';

import { formatLkr, type VehicleSummary } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { submitErrorFrom } from '@/lib/forms';
import { formatDate } from '@/lib/provider-labels';
import { categoryName, useReferenceData } from '@/lib/reference';
import { VEHICLE_STATUS, vehicleTitle } from '@/lib/vehicle-labels';

export default function ProviderVehiclesPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const reference = useReferenceData();
  const [vehicles, setVehicles] = useState<VehicleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (area.status !== 'ready') return;
    let cancelled = false;
    withAccessToken((token) => api.vehicles.list(token))
      .then((rows) => {
        if (!cancelled) setVehicles(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, withAccessToken]);

  if (area.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <FormMessage variant="destructive">{area.message}</FormMessage>
      </main>
    );
  }
  if (area.status === 'loading' || vehicles === null) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted-foreground text-sm">{error ?? 'Loading your vehicles…'}</p>
      </main>
    );
  }
  const ref = reference.status === 'ready' ? reference.data : undefined;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Vehicles</h1>
          <p className="text-muted-foreground text-sm">
            Each listing is reviewed by our team before it goes live. Photos come in a later
            release.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/provider/vehicles/new" />}
          disabled={area.profile.status === 'suspended'}
        >
          Add vehicle
        </Button>
      </header>
      {area.profile.status === 'suspended' ? (
        <FormMessage variant="destructive" title="Your provider account is suspended">
          Vehicles are read-only until the suspension is lifted.
        </FormMessage>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Vehicle</th>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Plate</th>
              <th className="p-3 font-medium">Daily rate</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Updated</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="p-3">
                  <Link
                    href={`/provider/vehicles/${v.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {vehicleTitle(v)}
                  </Link>
                </td>
                <td className="p-3">{categoryName(ref, v.categoryId)}</td>
                <td className="p-3">{v.registrationNumber ?? '—'}</td>
                <td className="p-3">{formatLkr(v.dailyRate)}</td>
                <td className="p-3">
                  <Badge variant={VEHICLE_STATUS[v.status].tone}>
                    {VEHICLE_STATUS[v.status].label}
                  </Badge>
                </td>
                <td className="p-3">{formatDate(v.updatedAt)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/provider/vehicles/${v.id}`} />}
                  >
                    Edit
                  </Button>{' '}
                  {v.status === 'approved' || v.status === 'inactive' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={`/provider/vehicles/${v.id}/availability`} />}
                    >
                      Availability
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {vehicles.length === 0 ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={7}>
                  No vehicles yet. Add your first listing.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
