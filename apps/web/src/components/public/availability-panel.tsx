'use client';

import { formatLkr, type BookingQuote, type PublicPricing } from '@vrp/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/auth-context';
import { requestBookingHref } from '@/lib/booking-form';
import { submitErrorFrom } from '@/lib/forms';
import { parseSearchParams } from '@/lib/search-params';
import { colomboDateToInstant, formatDay, todayInColombo } from '@/lib/vehicle-labels';

interface AvailabilityPanelProps {
  slug: string;
  pricing: PublicPricing;
}

const REASON_TEXT: Record<BookingQuote['reasons'][number], string> = {
  not_bookable: 'This vehicle cannot be booked right now.',
  date_conflict: 'Not available for these dates.',
  outside_min_days: 'The rental is shorter than the minimum for this vehicle.',
  outside_max_days: 'The rental is longer than the maximum for this vehicle.',
  too_soon: 'Pickup must be at least 2 hours from now.',
  too_far_ahead: 'Pickup must be within the next 12 months.',
};

/**
 * Date-aware part of the public vehicle page: quotes the real price and
 * availability through the public API and leads to the booking request. Dates
 * arrive from the search page in the URL and are kept there when changed.
 */
export function AvailabilityPanel({ slug, pricing }: AvailabilityPanelProps) {
  const params = useSearchParams();
  const router = useRouter();
  const { api } = useAuth();
  const initial = parseSearchParams(params);
  const [startDate, setStartDate] = useState(initial.startDate ?? '');
  const [endDate, setEndDate] = useState(initial.endDate ?? '');
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [quotedDates, setQuotedDates] = useState<{ startDate: string; endDate: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Quote automatically when the page opens with dates from a search.
  useEffect(() => {
    if (!initial.startDate || !initial.endDate) return;
    const dates = { startDate: initial.startDate, endDate: initial.endDate };
    let cancelled = false;
    api.public
      .quote(slug, colomboDateToInstant(dates.startDate), colomboDateToInstant(dates.endDate))
      .then((result) => {
        if (cancelled) return;
        setQuote(result);
        setQuotedDates(dates);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, slug, initial.startDate, initial.endDate]);

  async function check() {
    setError(null);
    if (!startDate || !endDate || endDate <= startDate) {
      setError('Choose a pickup day and a later return day.');
      return;
    }
    setBusy(true);
    try {
      const next = new URLSearchParams(params.toString());
      next.set('startDate', startDate);
      next.set('endDate', endDate);
      router.replace(`?${next.toString()}`, { scroll: false });
      const result = await api.public.quote(
        slug,
        colomboDateToInstant(startDate),
        colomboDateToInstant(endDate),
      );
      setQuote(result);
      setQuotedDates({ startDate, endDate });
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  const today = todayInColombo();
  const canRequest = quote !== null && quote.bookable && quotedDates !== null;
  return (
    <div className="grid gap-4 rounded-lg border p-4">
      <div>
        <p className="text-2xl font-semibold">
          {formatLkr(pricing.dailyRate)}{' '}
          <span className="text-muted-foreground text-base font-normal">/ day</span>
        </p>
        <p className="text-muted-foreground text-xs">
          Deposit {formatLkr(pricing.securityDeposit)} (refundable) ·{' '}
          {pricing.includedKmPerDay === null
            ? 'unlimited km'
            : `${pricing.includedKmPerDay} km/day, extra ${formatLkr(pricing.extraKmRate)}/km`}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pickup">Pickup</Label>
          <Input
            id="pickup"
            type="date"
            min={today}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="return">Return</Label>
          <Input
            id="return"
            type="date"
            min={startDate || today}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => void check()}>
        {busy ? 'Checking…' : 'Check price and availability'}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {quote ? (
        <div className="grid gap-2 text-sm">
          <p>
            {quote.bookable ? (
              <Badge>Available</Badge>
            ) : (
              <Badge variant="destructive">
                {quote.available ? 'Cannot be booked for these dates' : 'Not available'}
              </Badge>
            )}{' '}
            {formatDay(quote.startsAt)} → {formatDay(quote.endsAt)} · {quote.price.rentalDays} day
            {quote.price.rentalDays === 1 ? '' : 's'}
          </p>
          {!quote.bookable ? (
            <ul className="text-muted-foreground list-disc pl-5 text-xs">
              {quote.reasons.map((reason) => (
                <li key={reason}>{REASON_TEXT[reason]}</li>
              ))}
            </ul>
          ) : null}
          <p>
            Rental <span className="font-medium">{formatLkr(quote.price.subtotal)}</span>{' '}
            <span className="text-muted-foreground">
              ({quote.price.lines[0]?.label ?? `${quote.price.rentalDays} days`})
            </span>
          </p>
        </div>
      ) : null}
      {canRequest && quotedDates ? (
        <Button
          nativeButton={false}
          render={
            <Link href={requestBookingHref(slug, quotedDates.startDate, quotedDates.endDate)} />
          }
        >
          Request to book
        </Button>
      ) : (
        <Button disabled>Request to book</Button>
      )}
      <FormMessage>
        You pay nothing online in this release. The provider accepts or declines your request; the
        deposit, fuel and extras are settled with the provider at pickup and return.
      </FormMessage>
    </div>
  );
}
