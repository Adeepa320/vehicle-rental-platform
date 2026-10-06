'use client';

import {
  BOOKING_PRICE_NOTE,
  formatLkr,
  type Booking,
  type BookingContact,
  type BookingEvent,
  type BookingSummary,
} from '@vrp/contracts';
import Link from 'next/link';
import { useState } from 'react';

import { AuthCard } from '@/components/auth/form-primitives';
import { Photo } from '@/components/public/photo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  BOOKING_STATUS,
  EVENT_LABEL,
  FUEL_LEVEL_LABEL,
  formatDateTime,
} from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDay } from '@/lib/vehicle-labels';

export function BookingStatusBadge({ status }: { status: Booking['status'] }) {
  const meta = BOOKING_STATUS[status];
  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

/** One row in a booking list; `href` decides which area it opens in. */
export function BookingRow({ booking, href }: { booking: BookingSummary; href: string }) {
  const counterpart =
    booking.viewer === 'customer' ? booking.provider.displayName : booking.customer.name;
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-muted/50 flex flex-wrap items-center gap-4 rounded-md border p-3 transition-colors"
      >
        <Photo
          src={booking.vehicle.thumbnailUrl}
          alt={booking.vehicle.title}
          className="aspect-[4/3] w-24 shrink-0"
          sizes="96px"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{booking.vehicle.title}</p>
          <p className="text-muted-foreground text-sm">
            {formatDay(booking.startsAt)} → {formatDay(booking.endsAt)} · {booking.rentalDays} day
            {booking.rentalDays === 1 ? '' : 's'} · {counterpart}
          </p>
          <p className="text-muted-foreground text-xs">
            {booking.reference} · requested {formatDateTime(booking.createdAt)}
          </p>
        </div>
        <div className="grid justify-items-end gap-1 text-right">
          <BookingStatusBadge status={booking.status} />
          <p className="text-sm font-medium">{formatLkr(booking.price.subtotal)}</p>
        </div>
      </Link>
    </li>
  );
}

export function PriceCard({ booking }: { booking: Booking }) {
  const p = booking.price;
  return (
    <AuthCard title="Price" description="Fixed when the request was made; it does not change.">
      <dl className="grid gap-2 text-sm sm:grid-cols-[1fr_auto]">
        {p.lines.map((line) => (
          <div key={line.code} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="font-medium">{formatLkr(line.amount)}</dd>
          </div>
        ))}
        <div className="contents">
          <dt className="text-muted-foreground">Rental total</dt>
          <dd className="font-semibold">{formatLkr(p.subtotal)}</dd>
        </div>
        <div className="contents">
          <dt className="text-muted-foreground">
            Advance paid online ({Number(p.advancePercentage)}% of the rental)
          </dt>
          <dd className="font-medium">{formatLkr(p.advance)}</dd>
        </div>
        <div className="contents">
          <dt className="text-muted-foreground">Balance paid to the provider at pickup</dt>
          <dd>{formatLkr(p.balanceDue)}</dd>
        </div>
        <div className="contents">
          <dt className="text-muted-foreground">Refundable deposit (at pickup, returned after)</dt>
          <dd>{formatLkr(p.securityDeposit)}</dd>
        </div>
        <div className="contents">
          <dt className="text-muted-foreground">Included distance</dt>
          <dd>
            {p.includedKmTotal === null
              ? 'Unlimited'
              : `${p.includedKmTotal} km (${p.includedKmPerDay} km/day)${p.extraKmRate ? `, extra ${formatLkr(p.extraKmRate)}/km` : ''}`}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-3 text-xs">{BOOKING_PRICE_NOTE}</p>
    </AuthCard>
  );
}

export function PickupCard({ booking }: { booking: Booking }) {
  const pickup = booking.pickup;
  return (
    <AuthCard
      title="Pickup"
      description={
        pickup.address
          ? 'Exact address and instructions.'
          : 'The exact address is shared once the booking is confirmed.'
      }
    >
      <div className="grid gap-1 text-sm">
        <p className="font-medium">
          {pickup.locationName} · {pickup.placeName}, {pickup.districtName}
        </p>
        {pickup.address ? <p>{pickup.address}</p> : null}
        {pickup.instructions ? (
          <p className="text-muted-foreground whitespace-pre-wrap">{pickup.instructions}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Pickup {formatDateTime(booking.startsAt)} · return {formatDateTime(booking.endsAt)} (Sri
          Lanka time)
        </p>
      </div>
    </AuthCard>
  );
}

export function DriverCard({ booking }: { booking: Booking }) {
  if (!booking.driver) return null;
  return (
    <AuthCard
      title="Driver"
      description="As given with the request. The provider checks the physical licence at pickup."
    >
      <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{booking.driver.fullName}</dd>
        <dt className="text-muted-foreground">Licence issued in</dt>
        <dd>{booking.driver.licenceCountry}</dd>
        <dt className="text-muted-foreground">Licence valid until</dt>
        <dd>{booking.driver.licenceExpiresOn}</dd>
        {booking.driver.countryCode ? (
          <>
            <dt className="text-muted-foreground">Country of residence</dt>
            <dd>{booking.driver.countryCode}</dd>
          </>
        ) : null}
      </dl>
    </AuthCard>
  );
}

export function HandoverCard({ booking }: { booking: Booking }) {
  const h = booking.handover;
  if (!booking.pickedUpAt && !booking.completedAt) return null;
  const reading = (km: number | null, fuel: number | null, note: string | null) =>
    [
      km === null ? null : `${km} km`,
      fuel === null ? null : `fuel ${FUEL_LEVEL_LABEL[fuel] ?? fuel}`,
      note,
    ]
      .filter(Boolean)
      .join(' · ') || 'No readings recorded';
  return (
    <AuthCard
      title="Handover records"
      description="Recorded by the provider; both sides receive a copy."
    >
      <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
        <dt className="text-muted-foreground">Pickup {formatDateTime(booking.pickedUpAt)}</dt>
        <dd>{reading(h.pickupOdometerKm, h.pickupFuelLevel, h.pickupNote)}</dd>
        {booking.completedAt ? (
          <>
            <dt className="text-muted-foreground">Return {formatDateTime(booking.completedAt)}</dt>
            <dd>{reading(h.returnOdometerKm, h.returnFuelLevel, h.returnNote)}</dd>
          </>
        ) : null}
      </dl>
    </AuthCard>
  );
}

export function TimelineCard({ events }: { events: BookingEvent[] }) {
  return (
    <AuthCard title="Timeline" description="Every change to this booking, oldest first.">
      <ol className="grid gap-2 text-sm">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0"
          >
            <span>
              {EVENT_LABEL[event.action] ?? event.action}
              {event.metadata && 'automatic' in event.metadata && event.metadata.automatic
                ? ' (automatic: another booking was accepted for these dates)'
                : ''}
              <span className="text-muted-foreground"> · {event.actorType}</span>
            </span>
            <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
          </li>
        ))}
      </ol>
    </AuthCard>
  );
}

/** Button that fetches and shows the counterparty's contact details (API logs the reveal). */
export function ContactReveal({
  bookingId,
  party,
}: {
  bookingId: string;
  party: 'provider' | 'customer';
}) {
  const { api, withAccessToken } = useAuth();
  const [contact, setContact] = useState<BookingContact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (contact) {
    return (
      <div className="grid gap-1 rounded-md border p-3 text-sm">
        <p className="font-medium">{contact.name}</p>
        <p>
          <a className="underline underline-offset-4" href={`mailto:${contact.email}`}>
            {contact.email}
          </a>
        </p>
        {contact.phone ? (
          <p>
            <a className="underline underline-offset-4" href={`tel:${contact.phone}`}>
              {contact.phone}
            </a>
            {contact.whatsappUrl ? (
              <>
                {' · '}
                <a
                  className="underline underline-offset-4"
                  href={contact.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground">No phone number on file.</p>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setContact(await withAccessToken((t) => api.bookings.contact(t, bookingId)));
          } catch (caught) {
            setError(submitErrorFrom(caught).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Loading…' : `Show ${party} contact details`}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
