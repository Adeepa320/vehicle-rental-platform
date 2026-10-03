import { CreateBookingRequestSchema, IdempotencyKeySchema } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import {
  newIdempotencyKey,
  parseRequestParams,
  requestBookingHref,
  toCreateBookingPayload,
} from '../booking-form';

describe('booking request form helpers', () => {
  it('builds a request link that keeps the chosen dates', () => {
    expect(requestBookingHref('toyota-aqua-2018-mirissa-ab12', '2026-11-12', '2026-11-15')).toBe(
      '/bookings/new?vehicle=toyota-aqua-2018-mirissa-ab12&startDate=2026-11-12&endDate=2026-11-15',
    );
  });

  it('parses the request parameters leniently', () => {
    expect(
      parseRequestParams(
        new URLSearchParams(
          'vehicle=toyota-aqua-2018-mirissa-ab12&startDate=2026-11-12&endDate=2026-11-15',
        ),
      ),
    ).toEqual({
      slug: 'toyota-aqua-2018-mirissa-ab12',
      startDate: '2026-11-12',
      endDate: '2026-11-15',
    });
    expect(
      parseRequestParams(new URLSearchParams('vehicle=x&startDate=2026-11-15&endDate=2026-11-12')),
    ).toEqual({
      slug: 'x',
      startDate: undefined,
      endDate: undefined,
    });
    expect(parseRequestParams({ vehicle: '../../etc', startDate: 'nope' }).slug).toBeUndefined();
  });

  it('produces a payload the shared schema accepts, with normalised country codes', () => {
    const payload = toCreateBookingPayload(
      {
        fullName: '  Nimal Perera ',
        countryCode: 'lk',
        licenceCountry: 'lk',
        licenceExpiresOn: '2030-01-01',
        customerNote: '  ',
      },
      {
        vehicleId: '0192f0a0-0000-7000-8000-000000000123',
        quoteToken: 'eyJhIjoxfQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
      },
      { startDate: '2026-11-12', endDate: '2026-11-15' },
    );
    expect(payload).toMatchObject({
      startsAt: '2026-11-12T00:00:00+05:30',
      endsAt: '2026-11-15T00:00:00+05:30',
      driver: { fullName: 'Nimal Perera', countryCode: 'LK', licenceCountry: 'LK' },
      customerNote: null,
    });
    expect(CreateBookingRequestSchema.safeParse(payload).success).toBe(true);
  });

  it('generates valid, unique idempotency keys', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(IdempotencyKeySchema.safeParse(a).success).toBe(true);
  });
});
