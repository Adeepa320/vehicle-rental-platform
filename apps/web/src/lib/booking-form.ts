import type { BookingQuote } from '@vrp/contracts';

import { colomboDateToInstant } from './vehicle-labels';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_OR_ID = /^[a-z0-9][a-z0-9-]{0,80}$/i;

/** Client-generated `Idempotency-Key` for one booking attempt (reused on retries of that attempt). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface BookingRequestParams {
  slug?: string;
  startDate?: string;
  endDate?: string;
}

/** `/bookings/new?vehicle=<slug>&startDate=&endDate=`; malformed values are dropped. */
export function parseRequestParams(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): BookingRequestParams {
  const read = (key: string): string | undefined => {
    const value = source instanceof URLSearchParams ? (source.get(key) ?? undefined) : source[key];
    const single = Array.isArray(value) ? value[0] : value;
    return single?.trim() || undefined;
  };
  const slug = read('vehicle');
  const startDate = read('startDate');
  const endDate = read('endDate');
  const datesValid =
    startDate !== undefined &&
    endDate !== undefined &&
    DAY.test(startDate) &&
    DAY.test(endDate) &&
    endDate > startDate;
  return {
    slug: slug && SLUG_OR_ID.test(slug) ? slug : undefined,
    startDate: datesValid ? startDate : undefined,
    endDate: datesValid ? endDate : undefined,
  };
}

export function requestBookingHref(slug: string, startDate: string, endDate: string): string {
  const params = new URLSearchParams({ vehicle: slug, startDate, endDate });
  return `/bookings/new?${params.toString()}`;
}

export interface BookingRequestForm {
  fullName: string;
  countryCode: string;
  licenceCountry: string;
  licenceExpiresOn: string;
  customerNote: string;
}

/** Form values → `POST /bookings` body (validated by `CreateBookingRequestSchema` before sending). */
export function toCreateBookingPayload(
  form: BookingRequestForm,
  quote: Pick<BookingQuote, 'vehicleId' | 'quoteToken'>,
  dates: { startDate: string; endDate: string },
) {
  const note = form.customerNote.trim();
  return {
    vehicleId: quote.vehicleId,
    startsAt: colomboDateToInstant(dates.startDate),
    endsAt: colomboDateToInstant(dates.endDate),
    quoteToken: quote.quoteToken ?? '',
    driver: {
      fullName: form.fullName.trim(),
      countryCode: form.countryCode.trim() === '' ? null : form.countryCode.trim().toUpperCase(),
      licenceCountry: form.licenceCountry.trim().toUpperCase(),
      licenceExpiresOn: form.licenceExpiresOn,
    },
    customerNote: note === '' ? null : note,
  };
}
