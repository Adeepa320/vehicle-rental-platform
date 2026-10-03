'use client';

import { formatLkr, type PublicAvailability, type PublicPricing } from '@vrp/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';
import { parseSearchParams } from '@/lib/search-params';
import { colomboDateToInstant, formatDay, todayInColombo } from '@/lib/vehicle-labels';

interface AvailabilityPanelProps {
  slug: string;
  pricing: PublicPricing;
}

/**
 * Date-aware part of the public vehicle page: checks real availability through
 * the public API and shows the informational estimate. Dates arrive from the
 * search page in the URL and are kept there when the user changes them.
 */
export function AvailabilityPanel({ slug, pricing }: AvailabilityPanelProps) {
  const params = useSearchParams();
  const router = useRouter();
  const { api } = useAuth();
  const initial = parseSearchParams(params);
  const [startDate, setStartDate] = useState(initial.startDate ?? '');
  const [endDate, setEndDate] = useState(initial.endDate ?? '');
  const [result, setResult] = useState<PublicAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Check automatically when the page opens with dates from a search.
  useEffect(() => {
    if (!initial.startDate || !initial.endDate) return;
    let cancelled = false;
    api.public
      .vehicle(slug, {
        startsAt: colomboDateToInstant(initial.startDate),
        endsAt: colomboDateToInstant(initial.endDate),
      })
      .then((detail) => {
        if (!cancelled) setResult(detail.availability);
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
      const detail = await api.public.vehicle(slug, {
        startsAt: colomboDateToInstant(startDate),
        endsAt: colomboDateToInstant(endDate),
      });
      setResult(detail.availability);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  const today = todayInColombo();
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
        {busy ? 'Checking…' : 'Check availability'}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {result ? (
        <div className="grid gap-2 text-sm">
          <p>
            {result.available && result.meetsRentalLength ? (
              <Badge>Available</Badge>
            ) : result.available ? (
              <Badge variant="destructive">
                Rental must be {pricing.minRentalDays}
                {pricing.maxRentalDays ? `–${pricing.maxRentalDays}` : '+'} days
              </Badge>
            ) : (
              <Badge variant="destructive">Not available for these dates</Badge>
            )}{' '}
            {formatDay(result.startsAt)} → {formatDay(result.endsAt)} · {result.days} day
            {result.days === 1 ? '' : 's'}
          </p>
          {result.estimate ? (
            <p>
              Estimated <span className="font-medium">{formatLkr(result.estimate.subtotal)}</span>{' '}
              <span className="text-muted-foreground">
                ({result.estimate.basis} rate) · {result.estimate.note}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      <Button disabled title="Booking requests open in the next release">
        Request booking — coming next
      </Button>
      <FormMessage>
        Booking and payment are not available yet. Prices are the provider’s listed rates; the
        deposit is paid at pickup. No commission or fees are added here.
      </FormMessage>
    </div>
  );
}
