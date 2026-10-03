'use client';

import {
  CreateBookingRequestSchema,
  formatLkr,
  type BookingQuote,
  type PublicVehicleDetail,
} from '@vrp/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Photo, photoSrc } from '@/components/public/photo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import {
  newIdempotencyKey,
  parseRequestParams,
  toCreateBookingPayload,
  type BookingRequestForm,
} from '@/lib/booking-form';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { vehicleHref } from '@/lib/search-params';
import { colomboDateToInstant, formatDay } from '@/lib/vehicle-labels';

export default function NewBookingPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl px-4 py-12">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <NewBookingForm />
    </Suspense>
  );
}

function NewBookingForm() {
  const gate = useRequireAuth();
  const { api, user, withAccessToken } = useAuth();
  const router = useRouter();
  const params = parseRequestParams(useSearchParams());
  const [vehicle, setVehicle] = useState<PublicVehicleDetail | null>(null);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<BookingRequestForm>({
    fullName: '',
    countryCode: 'LK',
    licenceCountry: 'LK',
    licenceExpiresOn: '',
    customerNote: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt: a retry of the same attempt replays instead of creating twice.
  const idempotencyKey = useRef(newIdempotencyKey());

  const { slug, startDate, endDate } = params;

  useEffect(() => {
    if (gate !== 'ready' || !slug || !startDate || !endDate) return;
    let cancelled = false;
    Promise.all([
      api.public.vehicle(slug),
      api.public.quote(slug, colomboDateToInstant(startDate), colomboDateToInstant(endDate)),
    ])
      .then(([v, q]) => {
        if (cancelled) return;
        setVehicle(v);
        setQuote(q);
        setForm((current) =>
          current.fullName === '' ? { ...current, fullName: user?.fullName ?? '' } : current,
        );
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, slug, startDate, endDate, user?.fullName]);

  async function refreshQuote() {
    if (!slug || !startDate || !endDate) return;
    setQuote(
      await api.public.quote(slug, colomboDateToInstant(startDate), colomboDateToInstant(endDate)),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!quote || !startDate || !endDate) return;
    setMessage(null);
    const parsed = CreateBookingRequestSchema.safeParse(
      toCreateBookingPayload(form, quote, { startDate, endDate }),
    );
    if (!parsed.success) {
      const fieldErrors = fieldErrorsFromZod(parsed.error);
      setErrors({
        fullName: fieldErrors.driver ?? '',
        licenceExpiresOn: fieldErrors.driver ?? '',
        ...Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path.at(-1) ?? '_'), issue.message]),
        ),
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const booking = await withAccessToken((t) =>
        api.bookings.create(t, parsed.data, idempotencyKey.current),
      );
      router.push(`/bookings/${booking.id}`);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      if (failure.code === 'QUOTE_CHANGED' || failure.code === 'QUOTE_EXPIRED') {
        await refreshQuote().catch(() => undefined);
        setMessage(
          `${failure.message} The price above has been refreshed; please review it and submit again.`,
        );
      } else if (failure.code === 'IDEMPOTENCY_CONFLICT') {
        idempotencyKey.current = newIdempotencyKey();
        setMessage(failure.message);
      } else {
        setMessage(failure.message);
      }
      setBusy(false);
    }
  }

  if (!slug || !startDate || !endDate) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive" title="Choose a vehicle and dates first">
          Open a vehicle page, pick your pickup and return days and use “Request to book”.{' '}
          <Link className="underline underline-offset-4" href="/search">
            Go to search
          </Link>
        </FormMessage>
      </main>
    );
  }
  if (gate !== 'ready') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Checking your session…</p>
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive">{loadError}</FormMessage>
      </main>
    );
  }
  if (!vehicle || !quote) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading the vehicle and price…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <Link
        href={vehicleHref(vehicle.slug, { startDate, endDate })}
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← Back to {vehicle.title}
      </Link>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Request to book</h1>
        <p className="text-muted-foreground text-sm">
          The provider has up to 24 hours to accept. The vehicle is not reserved until they do, and
          nothing is paid online in this release.
        </p>
      </header>

      <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[160px_1fr]">
        <Photo
          src={photoSrc(vehicle.photos[0], 'medium')}
          alt={vehicle.title}
          className="aspect-[4/3]"
          sizes="160px"
        />
        <div className="grid gap-1 text-sm">
          <p className="text-base font-medium">{vehicle.title}</p>
          <p className="text-muted-foreground">
            {vehicle.place.name}, {vehicle.place.districtName} · {vehicle.provider.displayName}
          </p>
          <p>
            {formatDay(quote.startsAt)} → {formatDay(quote.endsAt)} · {quote.price.rentalDays} day
            {quote.price.rentalDays === 1 ? '' : 's'}
          </p>
          <p>
            Rental <span className="font-semibold">{formatLkr(quote.price.subtotal)}</span>{' '}
            <span className="text-muted-foreground">({quote.price.lines[0]?.label})</span>
          </p>
          <p className="text-muted-foreground text-xs">
            Deposit {formatLkr(quote.price.securityDeposit)} refundable, paid to the provider at
            pickup. {quote.note}
          </p>
          {!quote.bookable ? (
            <FormMessage variant="destructive">
              This vehicle cannot be booked for these dates any more ({quote.reasons.join(', ')}).
            </FormMessage>
          ) : null}
        </div>
      </section>

      <AuthCard
        title="Driver details"
        description="Who will drive. The provider checks the physical licence at pickup; we do not store licence numbers or documents."
      >
        <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
          {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
          <FormField id="fullName" label="Driver’s full name" error={errors.fullName || undefined}>
            <Input
              id="fullName"
              value={form.fullName}
              onChange={(e) => setForm((c) => ({ ...c, fullName: e.target.value }))}
              autoComplete="name"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              id="licenceCountry"
              label="Licence issued in (country code)"
              error={errors.licenceCountry || undefined}
            >
              <Input
                id="licenceCountry"
                maxLength={2}
                value={form.licenceCountry}
                onChange={(e) => setForm((c) => ({ ...c, licenceCountry: e.target.value }))}
              />
            </FormField>
            <FormField
              id="licenceExpiresOn"
              label="Licence valid until"
              error={errors.licenceExpiresOn || undefined}
            >
              <Input
                id="licenceExpiresOn"
                type="date"
                min={endDate}
                value={form.licenceExpiresOn}
                onChange={(e) => setForm((c) => ({ ...c, licenceExpiresOn: e.target.value }))}
              />
            </FormField>
            <FormField
              id="countryCode"
              label="Country of residence (optional)"
              error={errors.countryCode || undefined}
            >
              <Input
                id="countryCode"
                maxLength={2}
                value={form.countryCode}
                onChange={(e) => setForm((c) => ({ ...c, countryCode: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField
            id="customerNote"
            label="Message to the provider (optional)"
            error={errors.customerNote || undefined}
          >
            <Textarea
              id="customerNote"
              className="min-h-20"
              placeholder="Arrival time, pickup preferences, questions…"
              value={form.customerNote}
              onChange={(e) => setForm((c) => ({ ...c, customerNote: e.target.value }))}
            />
          </FormField>
          <Button type="submit" disabled={busy || !quote.bookable}>
            {busy ? 'Sending request…' : 'Send booking request'}
          </Button>
          <p className="text-muted-foreground text-xs">
            Foreign licence holders need an International Driving Permit recognised in Sri Lanka.
            The provider will refuse the handover without valid documents.
          </p>
        </form>
      </AuthCard>
    </main>
  );
}
