'use client';

import type { BookingScope, BookingSummary } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { BookingRow } from '@/components/bookings/booking-parts';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { submitErrorFrom } from '@/lib/forms';

const SCOPES: { value: BookingScope; label: string }[] = [
  { value: 'open', label: 'Current' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

export default function CustomerBookingsPage() {
  const gate = useRequireAuth();
  const { api, withAccessToken } = useAuth();
  const [scope, setScope] = useState<BookingScope>('open');
  const [rows, setRows] = useState<BookingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== 'ready') return;
    let cancelled = false;
    withAccessToken((t) => api.bookings.list(t, { scope, limit: 50 }))
      .then((page) => {
        if (!cancelled) setRows(page.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, scope, withAccessToken]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My bookings</h1>
          <p className="text-muted-foreground text-sm">
            Requests you sent and rentals you have had. Dates are in Sri Lanka time.
          </p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/search" />}>
          Find a vehicle
        </Button>
      </header>
      <nav className="flex gap-2">
        {SCOPES.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={scope === s.value ? 'default' : 'outline'}
            onClick={() => {
              setScope(s.value);
              setRows(null);
            }}
          >
            {s.label}
          </Button>
        ))}
      </nav>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {gate !== 'ready' || rows === null ? (
        <p className="text-muted-foreground text-sm">Loading your bookings…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {scope === 'open'
            ? 'No current bookings. Search for a vehicle and request to book.'
            : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((booking) => (
            <BookingRow key={booking.id} booking={booking} href={`/bookings/${booking.id}`} />
          ))}
        </ul>
      )}
    </main>
  );
}
