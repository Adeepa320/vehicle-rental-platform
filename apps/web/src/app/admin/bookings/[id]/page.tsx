'use client';

import type { AdminBooking } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import {
  BookingStatusBadge,
  DriverCard,
  HandoverCard,
  PickupCard,
  PriceCard,
  TimelineCard,
} from '@/components/bookings/booking-parts';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { BOOKING_STATUS, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDay } from '@/lib/vehicle-labels';

export default function AdminBookingPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const [booking, setBooking] = useState<AdminBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  useEffect(() => {
    if (gate !== 'ready' || !isAdmin || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.getBooking(t, params.id))
      .then((b) => {
        if (!cancelled) setBooking(b);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, isAdmin, params.id, withAccessToken]);

  if (gate === 'ready' && !isAdmin) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </main>
    );
  }
  if (error) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive">{error}</FormMessage>
      </main>
    );
  }
  if (gate !== 'ready' || !booking) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading booking…</p>
      </main>
    );
  }

  const canConfirm = booking.allowedActions.includes('confirm_for_testing');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <AdminNav />
      <Link
        href="/admin/bookings"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← All bookings
      </Link>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {booking.reference} · {booking.vehicle.title}
          </h1>
          <BookingStatusBadge status={booking.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {formatDay(booking.startsAt)} → {formatDay(booking.endsAt)} · {booking.rentalDays} day
          {booking.rentalDays === 1 ? '' : 's'} · {booking.provider.displayName} ↔{' '}
          {booking.customer.name}
        </p>
        <p className="text-sm">{BOOKING_STATUS[booking.status].provider}</p>
      </header>

      {booking.status === 'accepted' ? (
        <FormMessage
          variant={booking.testingConfirmationEnabled ? 'default' : 'destructive'}
          title="Temporary testing action (Phase 6)"
        >
          Online payment is not implemented yet. This action moves the booking to “confirmed”
          without any payment record so the rest of the flow can be exercised locally. It is
          disabled in production and will be replaced by the payment confirmation in Phase 7.
          {canConfirm ? (
            <div className="mt-3">
              <ReasonAction
                label="Confirm for testing (no payment)"
                confirmLabel="Confirm booking"
                optional
                placeholder="Optional note for the audit log"
                onConfirm={async (note) => {
                  setBooking(
                    await withAccessToken((t) =>
                      api.admin.confirmBookingForTesting(t, booking.id, {
                        version: booking.version,
                        note: note === '' ? null : note,
                      }),
                    ),
                  );
                }}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs">Not available in this environment.</p>
          )}
        </FormMessage>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <AuthCard title="Parties" description="Visible to administrators only.">
          <dl className="grid gap-2 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-muted-foreground">Customer</dt>
            <dd>
              {booking.customer.name} · {booking.customerEmail}
            </dd>
            <dt className="text-muted-foreground">Provider</dt>
            <dd>
              {booking.provider.displayName} · {booking.providerEmail}
            </dd>
            <dt className="text-muted-foreground">Vehicle</dt>
            <dd>
              {booking.vehicle.title}
              {booking.vehicle.registrationNumber ? ` · ${booking.vehicle.registrationNumber}` : ''}
            </dd>
            <dt className="text-muted-foreground">Hold</dt>
            <dd>
              {booking.hold
                ? `${formatDateTime(booking.hold.startsAt)} → ${formatDateTime(booking.hold.endsAt)} (kind ${booking.hold.kind})`
                : 'None (requested bookings do not reserve the vehicle)'}
            </dd>
            <dt className="text-muted-foreground">Respond by</dt>
            <dd>{formatDateTime(booking.respondBy)}</dd>
            <dt className="text-muted-foreground">Confirm by</dt>
            <dd>{formatDateTime(booking.confirmBy)}</dd>
            <dt className="text-muted-foreground">Confirmation</dt>
            <dd>
              {booking.confirmationSource
                ? `${booking.confirmationSource} at ${formatDateTime(booking.confirmedAt)}`
                : '—'}
            </dd>
          </dl>
        </AuthCard>
        <PriceCard booking={booking} />
        <PickupCard booking={booking} />
        <DriverCard booking={booking} />
        <HandoverCard booking={booking} />
        {booking.customerNote || booking.providerNote ? (
          <AuthCard title="Notes">
            {booking.customerNote ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Customer:</span> {booking.customerNote}
              </p>
            ) : null}
            {booking.providerNote ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Provider:</span> {booking.providerNote}
              </p>
            ) : null}
          </AuthCard>
        ) : null}
      </div>
      <TimelineCard events={booking.events} />
    </main>
  );
}
