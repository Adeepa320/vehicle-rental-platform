'use client';

import type { BookingScope, BookingStatus, BookingSummary } from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { BookingRow } from '@/components/bookings/booking-parts';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { submitErrorFrom } from '@/lib/forms';

type Tab = { key: string; label: string; status?: BookingStatus; scope?: BookingScope };
const TABS: Tab[] = [
  { key: 'requests', label: 'Requests', status: 'requested' },
  { key: 'upcoming', label: 'Reserved and confirmed', scope: 'open' },
  { key: 'past', label: 'Past', scope: 'past' },
  { key: 'all', label: 'All', scope: 'all' },
];

export default function ProviderBookingsPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const [tab, setTab] = useState<Tab>(TABS[0] as Tab);
  const [rows, setRows] = useState<BookingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (area.status !== 'ready') return;
    let cancelled = false;
    withAccessToken((t) =>
      api.providerBookings.list(t, { status: tab.status, scope: tab.scope, limit: 50 }),
    )
      .then((page) => {
        if (!cancelled) setRows(page.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, tab, withAccessToken]);

  if (area.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive">{area.message}</FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Bookings</h1>
        <p className="text-muted-foreground text-sm">
          Requests wait for your answer; accepting reserves the vehicle. Dates are in Sri Lanka
          time.
        </p>
      </header>
      <nav className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab.key === t.key ? 'default' : 'outline'}
            onClick={() => {
              setTab(t);
              setRows(null);
            }}
          >
            {t.label}
          </Button>
        ))}
      </nav>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {area.status !== 'ready' || rows === null ? (
        <p className="text-muted-foreground text-sm">Loading bookings…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tab.key === 'requests' ? 'No open requests right now.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              href={`/provider/bookings/${booking.id}`}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
