'use client';

import { BookingStatusSchema, type BookingStatus, type BookingSummary } from '@vrp/contracts';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { FormMessage } from '@/components/auth/form-primitives';
import { BookingRow } from '@/components/bookings/booking-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { BOOKING_STATUS } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function AdminBookingsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl px-4 py-12">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <AdminBookingsList />
    </Suspense>
  );
}

function AdminBookingsList() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const searchParams = useSearchParams();
  // Scoping links from the provider / user / vehicle pages.
  const providerId = searchParams.get('providerId') ?? undefined;
  const customerId = searchParams.get('customerId') ?? undefined;
  const vehicleId = searchParams.get('vehicleId') ?? undefined;
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<BookingSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = q.trim();
  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          api.admin.listBookings(t, {
            status: status || undefined,
            q: search.length >= 2 ? search : undefined,
            from: from || undefined,
            to: to || undefined,
            providerId,
            customerId,
            vehicleId,
            cursor,
            limit: 30,
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
    [api, customerId, from, providerId, search, status, to, vehicleId, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  const scoped = providerId || customerId || vehicleId;

  return (
    <AdminShell area={area}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Bookings</h1>
        <p className="text-muted-foreground text-sm">
          All booking requests, newest first. Bookings are confirmed by the verified online advance;
          payments that need a human are listed under Payments.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as BookingStatus | '')}
        >
          <option value="">All statuses</option>
          {BookingStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {BOOKING_STATUS[s].label}
            </option>
          ))}
        </select>
        <Input
          className="w-64"
          placeholder="Reference, customer name or e-mail"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          Rental from
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          to
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {scoped ? (
        <p className="text-muted-foreground text-xs">
          Showing bookings for the selected{' '}
          {providerId ? 'provider' : customerId ? 'customer' : 'vehicle'} only.
        </p>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {loading && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Loading bookings…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No bookings match.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((booking) => (
            <BookingRow key={booking.id} booking={booking} href={`/admin/bookings/${booking.id}`} />
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </Button>
      ) : null}
    </AdminShell>
  );
}
