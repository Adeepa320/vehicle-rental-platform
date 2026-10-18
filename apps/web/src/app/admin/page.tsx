'use client';

import type { AdminOverview } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { FormMessage } from '@/components/auth/form-primitives';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

/** Operations home: what needs a human right now, each card opening its queue. */
export default function AdminOverviewPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.overview(t))
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ready, withAccessToken]);

  const attention = overview?.items.filter((i) => i.tone === 'attention') ?? [];
  const info = overview?.items.filter((i) => i.tone === 'info') ?? [];

  return (
    <AdminShell area={area}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Operations overview</h1>
        <p className="text-muted-foreground text-sm">
          Queues that need a decision are highlighted when they are not empty. Counts are live; open
          a card to work the queue.
        </p>
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {!overview ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading overview…
        </p>
      ) : (
        <>
          <section className="grid gap-3">
            <h2 className="text-sm font-medium">Needs attention</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {attention.map((item) => (
                <OverviewCard key={item.key} item={item} highlight={item.count > 0} />
              ))}
            </ul>
          </section>
          {info.length > 0 ? (
            <section className="grid gap-3">
              <h2 className="text-sm font-medium">Activity</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {info.map((item) => (
                  <OverviewCard key={item.key} item={item} highlight={false} />
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Generated {formatDateTime(overview.generatedAt)} (Sri Lanka time).
          </p>
        </>
      )}
    </AdminShell>
  );
}

function OverviewCard({
  item,
  highlight,
}: {
  item: AdminOverview['items'][number];
  highlight: boolean;
}) {
  return (
    <li>
      <Link
        href={item.linkPath}
        className={`hover:bg-muted/50 block rounded-md border p-4 transition-colors ${
          highlight ? 'border-destructive/60 bg-destructive/5' : ''
        }`}
      >
        <p className={`text-3xl font-semibold ${highlight ? 'text-destructive' : ''}`}>
          {item.count}
        </p>
        <p className="text-sm">{item.label}</p>
      </Link>
    </li>
  );
}
