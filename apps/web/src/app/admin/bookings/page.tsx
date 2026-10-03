'use client';

import { BookingStatusSchema, type BookingStatus, type BookingSummary } from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { FormMessage } from '@/components/auth/form-primitives';
import { BookingRow } from '@/components/bookings/booking-parts';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { BOOKING_STATUS } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

const selectClass =
  'border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

export default function AdminBookingsPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [reference, setReference] = useState('');
  const [rows, setRows] = useState<BookingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  useEffect(() => {
    if (gate !== 'ready' || !isAdmin) return;
    let cancelled = false;
    const ref = reference.trim();
    withAccessToken((t) =>
      api.admin.listBookings(t, {
        status: status === '' ? undefined : status,
        reference: ref.length >= 3 ? ref : undefined,
        limit: 50,
      }),
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
  }, [api, gate, isAdmin, reference, status, withAccessToken]);

  if (gate === 'ready' && !isAdmin) {
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
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Bookings</h1>
        <p className="text-muted-foreground text-sm">
          All booking requests, newest first. Confirmation without payment is a temporary testing
          action (Phase 6) and is disabled in production.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as BookingStatus | '');
            setRows(null);
          }}
        >
          <option value="">All statuses</option>
          {BookingStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {BOOKING_STATUS[s].label}
            </option>
          ))}
        </select>
        <Input
          className="w-56"
          placeholder="Reference, e.g. SLR-7F3K2Q"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {gate !== 'ready' || rows === null ? (
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
    </main>
  );
}
