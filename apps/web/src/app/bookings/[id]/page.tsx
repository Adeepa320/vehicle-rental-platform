'use client';

import type { Booking } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import {
  BookingStatusBadge,
  ContactReveal,
  DriverCard,
  HandoverCard,
  PickupCard,
  PriceCard,
  TimelineCard,
} from '@/components/bookings/booking-parts';
import { PayAdvanceButton, PaymentStateLine } from '@/components/bookings/payment-parts';
import { Photo } from '@/components/public/photo';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { BOOKING_STATUS, DECLINE_REASON_LABEL, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDay } from '@/lib/vehicle-labels';

export default function CustomerBookingPage() {
  const gate = useRequireAuth();
  const { api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== 'ready' || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.bookings.get(t, params.id))
      .then((b) => {
        if (!cancelled) setBooking(b);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, params.id, withAccessToken]);

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

  const meta = BOOKING_STATUS[booking.status];
  const can = (action: Booking['allowedActions'][number]) =>
    booking.allowedActions.includes(action);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <Link href="/bookings" className="text-muted-foreground text-sm underline underline-offset-4">
        ← My bookings
      </Link>
      <header className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Photo
          src={booking.vehicle.thumbnailUrl}
          alt={booking.vehicle.title}
          className="aspect-[4/3]"
          sizes="200px"
        />
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{booking.vehicle.title}</h1>
            <BookingStatusBadge status={booking.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            Booking {booking.reference} · {formatDay(booking.startsAt)} →{' '}
            {formatDay(booking.endsAt)} · {booking.rentalDays} day
            {booking.rentalDays === 1 ? '' : 's'} · {booking.provider.displayName}{' '}
            <Badge variant="secondary">Platform-approved provider</Badge>
          </p>
          <p className="text-sm">{meta.customer}</p>
          {booking.status === 'requested' ? (
            <p className="text-muted-foreground text-xs">
              The provider has until {formatDateTime(booking.respondBy)} to answer.
            </p>
          ) : null}
          {booking.status === 'declined' && booking.declineReason ? (
            <p className="text-sm">
              Reason: {DECLINE_REASON_LABEL[booking.declineReason]}
              {booking.declineNote ? ` — “${booking.declineNote}”` : ''}
            </p>
          ) : null}
          {booking.providerNote ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Message from the provider:</span>{' '}
              {booking.providerNote}
            </p>
          ) : null}
          {booking.vehicle.registrationNumber ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Registration:</span>{' '}
              {booking.vehicle.registrationNumber}
            </p>
          ) : null}
          {booking.status === 'accepted' || booking.payment.state !== 'not_started' ? (
            <PaymentStateLine payment={booking.payment} audience="customer" />
          ) : null}
          {booking.status === 'accepted' && booking.confirmBy ? (
            <p className="text-muted-foreground text-xs">
              Pay the advance by {formatDateTime(booking.confirmBy)} (Sri Lanka time) to keep the
              reservation. The balance and the refundable deposit are paid to the provider at
              pickup.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {can('pay') ? (
              <PayAdvanceButton bookingId={booking.id} amount={booking.price.advance} />
            ) : null}
            {can('cancel') ? (
              <ReasonAction
                label="Cancel booking"
                confirmLabel="Yes, cancel"
                variant="destructive"
                optional
                placeholder="Optional note for the provider"
                onConfirm={async (note) => {
                  setBooking(
                    await withAccessToken((t) =>
                      api.bookings.cancel(t, booking.id, {
                        version: booking.version,
                        note: note === '' ? null : note,
                      }),
                    ),
                  );
                }}
              />
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <PriceCard booking={booking} />
        <PickupCard booking={booking} />
        <AuthCard
          title="Provider"
          description={
            booking.contact.available
              ? 'Contact details are available for this booking.'
              : `Contact details are shared once the booking is ${booking.contact.revealStage}.`
          }
        >
          <p className="text-sm font-medium">{booking.provider.displayName}</p>
          <p className="text-muted-foreground mb-3 text-xs">Reviewed by the platform team.</p>
          {can('reveal_contact') ? <ContactReveal bookingId={booking.id} party="provider" /> : null}
        </AuthCard>
        <DriverCard booking={booking} />
        <HandoverCard booking={booking} />
        {booking.customerNote ? (
          <AuthCard title="Your message">
            <p className="text-sm whitespace-pre-wrap">{booking.customerNote}</p>
          </AuthCard>
        ) : null}
      </div>
      <TimelineCard events={booking.events} />
    </main>
  );
}
