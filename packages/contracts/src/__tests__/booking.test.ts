import { describe, expect, it } from 'vitest';

import {
  CreateBookingRequestSchema,
  DeclineBookingRequestSchema,
  HandoverRequestSchema,
  IdempotencyKeySchema,
  computeBookingPrice,
} from '../bookings/booking';

const pricing = {
  currency: 'LKR' as const,
  dailyRate: '7500',
  weeklyRate: '45000',
  monthlyRate: '150000',
  securityDeposit: '25000',
  includedKmPerDay: 100,
  extraKmRate: '40',
  minRentalDays: 1,
  maxRentalDays: 60,
};

const validRequest = {
  vehicleId: '0192f0a0-0000-7000-8000-000000000123',
  startsAt: '2026-11-12T00:00:00+05:30',
  endsAt: '2026-11-15T00:00:00+05:30',
  quoteToken: 'eyJhIjoxfQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
  driver: { fullName: 'Nimal Perera', licenceCountry: 'LK', licenceExpiresOn: '2029-04-30' },
  customerNote: 'Arriving by train',
};

describe('computeBookingPrice', () => {
  it('snapshots normalised rates and the tiered subtotal', () => {
    const price = computeBookingPrice(pricing, 3);
    expect(price).toMatchObject({
      currency: 'LKR',
      rentalDays: 3,
      basis: 'daily',
      dailyRate: '7500.00',
      weeklyRate: '45000.00',
      monthlyRate: '150000.00',
      subtotal: '22500.00',
      securityDeposit: '25000.00',
      includedKmPerDay: 100,
      includedKmTotal: 300,
      extraKmRate: '40.00',
    });
    expect(price.lines).toEqual([
      { code: 'rental', label: '3 days (daily rate)', amount: '22500.00' },
    ]);
  });

  it('uses the weekly and monthly tiers like the public estimate', () => {
    expect(computeBookingPrice(pricing, 7)).toMatchObject({
      basis: 'weekly',
      subtotal: '45000.00',
    });
    expect(computeBookingPrice(pricing, 38)).toMatchObject({
      basis: 'monthly',
      subtotal: '202500.00',
    });
    expect(
      computeBookingPrice({ ...pricing, includedKmPerDay: null }, 7).includedKmTotal,
    ).toBeNull();
  });
});

describe('CreateBookingRequestSchema', () => {
  it('accepts a complete request', () => {
    expect(CreateBookingRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('rejects client-supplied price fields and unknown keys', () => {
    for (const extra of [
      { subtotal: '1.00' },
      { price: { subtotal: '1.00' } },
      { status: 'accepted' },
    ]) {
      const result = CreateBookingRequestSchema.safeParse({ ...validRequest, ...extra });
      expect(result.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('requires a licence valid until the end of the rental and a sane window', () => {
    const expired = CreateBookingRequestSchema.safeParse({
      ...validRequest,
      driver: { ...validRequest.driver, licenceExpiresOn: '2026-11-13' },
    });
    expect(expired.success).toBe(false);
    if (!expired.success) {
      expect(expired.error.issues[0]?.path).toEqual(['driver', 'licenceExpiresOn']);
    }
    const sameDay = CreateBookingRequestSchema.safeParse({
      ...validRequest,
      driver: { ...validRequest.driver, licenceExpiresOn: '2026-11-15' },
    });
    expect(sameDay.success).toBe(true);
    expect(
      CreateBookingRequestSchema.safeParse({ ...validRequest, endsAt: validRequest.startsAt })
        .success,
    ).toBe(false);
    expect(
      CreateBookingRequestSchema.safeParse({ ...validRequest, endsAt: '2027-03-01T00:00:00+05:30' })
        .success,
    ).toBe(false);
  });
});

describe('transition request schemas', () => {
  it('requires a note when the decline reason is "other"', () => {
    expect(DeclineBookingRequestSchema.safeParse({ version: 1, reason: 'other' }).success).toBe(
      false,
    );
    expect(
      DeclineBookingRequestSchema.safeParse({
        version: 1,
        reason: 'other',
        note: 'Family emergency',
      }).success,
    ).toBe(true);
    expect(
      DeclineBookingRequestSchema.safeParse({ version: 1, reason: 'vehicle_unavailable' }).success,
    ).toBe(true);
  });

  it('bounds handover readings', () => {
    expect(
      HandoverRequestSchema.safeParse({ version: 2, odometerKm: 45210, fuelLevel: 6 }).success,
    ).toBe(true);
    expect(HandoverRequestSchema.safeParse({ version: 2, fuelLevel: 9 }).success).toBe(false);
    expect(HandoverRequestSchema.safeParse({ version: 0 }).success).toBe(false);
  });

  it('validates idempotency keys', () => {
    expect(IdempotencyKeySchema.safeParse('0192f0a0-0000-7000-8000-000000000123').success).toBe(
      true,
    );
    expect(IdempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(IdempotencyKeySchema.safeParse('has spaces in it').success).toBe(false);
  });
});
