'use client';

import {
  DeclineBookingRequestSchema,
  formatLkr,
  type Booking,
  type HandoverRequest,
  type ProviderDeclineReason,
} from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import {
  BookingStatusBadge,
  ContactReveal,
  DriverCard,
  HandoverCard,
  PickupCard,
  PriceCard,
  TimelineCard,
} from '@/components/bookings/booking-parts';
import { HandoverForm } from '@/components/bookings/handover-form';
import { PaymentStateLine } from '@/components/bookings/payment-parts';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { BOOKING_STATUS, PROVIDER_DECLINE_REASONS, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDay } from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

type Panel = 'none' | 'decline' | 'pickup' | 'return';

export default function ProviderBookingPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');

  useEffect(() => {
    if (area.status !== 'ready' || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.providerBookings.get(t, params.id))
      .then((b) => {
        if (!cancelled) setBooking(b);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, params.id, withAccessToken]);

  if (area.status === 'error' || error) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive">
          {area.status === 'error' ? area.message : error}
        </FormMessage>
      </main>
    );
  }
  if (area.status !== 'ready' || !booking) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading booking…</p>
      </main>
    );
  }

  const meta = BOOKING_STATUS[booking.status];
  const can = (action: Booking['allowedActions'][number]) =>
    booking.allowedActions.includes(action);
  const apply = async (fn: (token: string) => Promise<Booking>) => {
    setMessage(null);
    try {
      setBooking(await withAccessToken(fn));
      setPanel('none');
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setMessage(
        failure.code === 'STALE_VERSION'
          ? `${failure.message}`
          : failure.code === 'BOOKING_CONFLICT'
            ? 'This vehicle is no longer free for these dates (another booking or a block overlaps).'
            : failure.message,
      );
      throw caught;
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <Link
        href="/provider/bookings"
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
          {booking.rentalDays === 1 ? '' : 's'} · requested by {booking.customer.name} (member since{' '}
          {booking.customer.memberSince}
          {booking.customer.emailVerified ? ', e-mail verified' : ''})
        </p>
        <p className="text-sm">{meta.provider}</p>
        {booking.status === 'requested' ? (
          <p className="text-muted-foreground text-xs">
            Respond by {formatDateTime(booking.respondBy)}. Accepting also declines other requests
            that overlap these dates.
          </p>
        ) : null}
        {booking.status === 'accepted' || booking.payment.state !== 'not_started' ? (
          <PaymentStateLine payment={booking.payment} audience="provider" />
        ) : null}
        {booking.status === 'accepted' && booking.confirmBy ? (
          <p className="text-muted-foreground text-xs">
            Reserved on your calendar. If the advance is not paid by{' '}
            {formatDateTime(booking.confirmBy)}, the reservation is released automatically. You
            collect the balance of {formatLkr(booking.price.balanceDue)} and the deposit at pickup.
          </p>
        ) : null}
        {booking.customerNote ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Customer note:</span> {booking.customerNote}
          </p>
        ) : null}
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {can('accept') ? (
            <ReasonAction
              label="Accept request"
              confirmLabel="Accept and reserve"
              optional
              placeholder="Optional message to the customer (e.g. where to meet)"
              onConfirm={(note) =>
                apply((t) =>
                  api.providerBookings.accept(t, booking.id, {
                    version: booking.version,
                    providerNote: note === '' ? null : note,
                  }),
                )
              }
            />
          ) : null}
          {can('decline') ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPanel(panel === 'decline' ? 'none' : 'decline')}
            >
              Decline
            </Button>
          ) : null}
          {can('pickup') ? (
            <Button size="sm" onClick={() => setPanel(panel === 'pickup' ? 'none' : 'pickup')}>
              Record pickup
            </Button>
          ) : null}
          {can('return') ? (
            <Button size="sm" onClick={() => setPanel(panel === 'return' ? 'none' : 'return')}>
              Record return
            </Button>
          ) : null}
          {can('no_show') ? (
            <ReasonAction
              label="Mark no-show"
              confirmLabel="Confirm no-show"
              variant="destructive"
              placeholder="How you tried to reach the customer (required)"
              onConfirm={(note) =>
                apply((t) =>
                  api.providerBookings.noShow(t, booking.id, { version: booking.version, note }),
                )
              }
            />
          ) : null}
          {can('cancel') ? (
            <ReasonAction
              label="Cancel booking"
              confirmLabel="Yes, cancel"
              variant="destructive"
              optional
              placeholder="Optional note for the customer"
              onConfirm={(note) =>
                apply((t) =>
                  api.providerBookings.cancel(t, booking.id, {
                    version: booking.version,
                    note: note === '' ? null : note,
                  }),
                )
              }
            />
          ) : null}
        </div>
      </header>

      {panel === 'decline' ? (
        <DeclinePanel
          booking={booking}
          onSubmit={(reason, note) =>
            apply((t) =>
              api.providerBookings.decline(t, booking.id, {
                version: booking.version,
                reason,
                note: note === '' ? null : note,
              }),
            )
          }
          onCancel={() => setPanel('none')}
        />
      ) : null}
      {panel === 'pickup' || panel === 'return' ? (
        <HandoverForm
          kind={panel}
          booking={booking}
          onSubmit={(body: HandoverRequest) =>
            apply((t) =>
              panel === 'pickup'
                ? api.providerBookings.pickup(t, booking.id, body)
                : api.providerBookings.complete(t, booking.id, body),
            )
          }
          onCancel={() => setPanel('none')}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <PriceCard booking={booking} />
        <PickupCard booking={booking} />
        <DriverCard booking={booking} />
        <AuthCard
          title="Customer"
          description={
            booking.contact.available
              ? 'Contact details are available for this booking.'
              : `The customer’s contact details are shared once the booking is ${booking.contact.revealStage}.`
          }
        >
          <p className="text-sm font-medium">{booking.customer.name}</p>
          <p className="text-muted-foreground mb-3 text-xs">
            Member since {booking.customer.memberSince}
            {booking.customer.emailVerified ? ' · e-mail verified' : ''}
          </p>
          {can('reveal_contact') ? <ContactReveal bookingId={booking.id} party="customer" /> : null}
        </AuthCard>
        <HandoverCard booking={booking} />
      </div>
      <TimelineCard events={booking.events} />
    </main>
  );
}

function DeclinePanel({
  booking,
  onSubmit,
  onCancel,
}: {
  booking: Booking;
  onSubmit: (reason: ProviderDeclineReason, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<ProviderDeclineReason>('vehicle_unavailable');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4 rounded-md border p-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const parsed = DeclineBookingRequestSchema.safeParse({
          version: booking.version,
          reason,
          note: note.trim() === '' ? null : note.trim(),
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Check the form');
          return;
        }
        setBusy(true);
        try {
          await onSubmit(reason, note.trim());
        } catch {
          // The parent shows the API message.
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm font-medium">Decline this request</p>
      <FormField id="decline-reason" label="Reason (shown to the customer)">
        <select
          id="decline-reason"
          className={selectClass}
          value={reason}
          onChange={(e) => setReason(e.target.value as ProviderDeclineReason)}
        >
          {PROVIDER_DECLINE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        id="decline-note"
        label={reason === 'other' ? 'Note (required)' : 'Note (optional)'}
        error={error ?? undefined}
      >
        <Textarea
          id="decline-note"
          className="min-h-16"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? 'Declining…' : 'Decline request'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Back
        </Button>
      </div>
    </form>
  );
}
