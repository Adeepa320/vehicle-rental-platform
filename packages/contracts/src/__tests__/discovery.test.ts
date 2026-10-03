import { describe, expect, it } from 'vitest';

import {
  APPROX_GRID_DEGREES,
  PublicVehicleCardSchema,
  PublicVehicleQuerySchema,
  ReorderVehiclePhotosRequestSchema,
  VehicleSearchQuerySchema,
  approximatePoint,
  estimateRental,
  rentalDays,
} from '../index';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

describe('search query', () => {
  it('coerces and defaults query-string values', () => {
    const parsed = VehicleSearchQuerySchema.parse({
      placeId: '0192f0a0-0000-7000-8000-000000000001',
      minSeats: '4',
      hasAc: 'true',
      deliveryAvailable: '0',
      minDailyRate: '5000',
      limit: '10',
    });
    expect(parsed).toMatchObject({
      minSeats: 4,
      hasAc: true,
      deliveryAvailable: false,
      sort: 'relevance',
      limit: 10,
    });
  });

  it('requires both dates or none, end after start, and a sane window', () => {
    const fails = (q: Record<string, unknown>) =>
      VehicleSearchQuerySchema.safeParse(q).success === false;
    expect(fails({ startsAt: iso(2) })).toBe(true);
    expect(fails({ startsAt: iso(3), endsAt: iso(2) })).toBe(true);
    expect(fails({ startsAt: iso(2), endsAt: iso(100) })).toBe(true);
    expect(fails({ startsAt: iso(400), endsAt: iso(402) })).toBe(true);
    expect(fails({ startsAt: iso(-10), endsAt: iso(-5) })).toBe(true);
    expect(fails({ minDailyRate: '9000', maxDailyRate: '5000' })).toBe(true);
    expect(fails({ limit: '500' })).toBe(true);
    expect(fails({ sort: 'rating' })).toBe(true);
    expect(VehicleSearchQuerySchema.safeParse({ startsAt: iso(2), endsAt: iso(5) }).success).toBe(
      true,
    );
    expect(PublicVehicleQuerySchema.safeParse({ endsAt: iso(5) }).success).toBe(false);
  });
});

describe('rental estimate', () => {
  const pricing = { dailyRate: '7500.00', weeklyRate: '45000.00', monthlyRate: '150000.00' };

  it('counts whole days for a half-open window', () => {
    expect(rentalDays('2026-11-01T03:30:00Z', '2026-11-04T03:30:00Z')).toBe(3);
    expect(rentalDays('2026-11-01T03:30:00Z', '2026-11-01T10:00:00Z')).toBe(1);
    expect(rentalDays('2026-11-01T03:30:00Z', '2026-11-03T04:00:00Z')).toBe(3);
  });

  it('applies monthly, then weekly, then daily rates and never exceeds daily pricing', () => {
    expect(estimateRental(pricing, 3)).toMatchObject({ subtotal: '22500.00', basis: 'daily' });
    expect(estimateRental(pricing, 7)).toMatchObject({ subtotal: '45000.00', basis: 'weekly' });
    expect(estimateRental(pricing, 10)).toMatchObject({ subtotal: '67500.00', basis: 'weekly' });
    expect(estimateRental(pricing, 30)).toMatchObject({ subtotal: '150000.00', basis: 'monthly' });
    expect(estimateRental(pricing, 38)).toMatchObject({ subtotal: '202500.00', basis: 'monthly' });
    // A "weekly" rate that is worse than daily pricing is ignored.
    expect(
      estimateRental({ dailyRate: '1000.00', weeklyRate: '7500.00', monthlyRate: null }, 7),
    ).toMatchObject({
      subtotal: '7000.00',
      basis: 'daily',
    });
    expect(
      estimateRental({ dailyRate: '1000.00', weeklyRate: null, monthlyRate: null }, 45).subtotal,
    ).toBe('45000.00');
    expect(estimateRental(pricing, 3).note).toMatch(/Not a booking quote/);
  });
});

describe('public privacy helpers', () => {
  it('snaps points to the grid deterministically', () => {
    const exact = { lat: 5.94851, lng: 80.47183 };
    const approx = approximatePoint(exact);
    expect(approx).toEqual({ lat: 5.95, lng: 80.47 });
    expect(approximatePoint(exact)).toEqual(approx);
    expect(Math.abs(approx.lat - exact.lat)).toBeLessThanOrEqual(APPROX_GRID_DEGREES / 2 + 1e-9);
    expect(approximatePoint({ lat: 6.0349, lng: 80.2168 })).toEqual({ lat: 6.035, lng: 80.215 });
  });

  it('keeps private fields out of the public card shape', () => {
    const shape = PublicVehicleCardSchema.shape;
    for (const forbidden of [
      'registrationNumber',
      'internalName',
      'adminNotes',
      'reviewReason',
      'pickupNotes',
      'addressText',
      'point',
      'phone',
      'email',
    ]) {
      expect(shape, forbidden).not.toHaveProperty(forbidden);
    }
    expect(PublicVehicleCardSchema.shape.approxPoint.unwrap().shape.source.options).toEqual([
      'approximate',
      'place',
    ]);
  });
});

describe('photo reorder request', () => {
  it('requires unique ids and rejects extra keys', () => {
    const a = '0192f0a0-0000-7000-8000-000000000001';
    const b = '0192f0a0-0000-7000-8000-000000000002';
    expect(ReorderVehiclePhotosRequestSchema.safeParse({ photoIds: [a, b] }).success).toBe(true);
    expect(ReorderVehiclePhotosRequestSchema.safeParse({ photoIds: [a, a] }).success).toBe(false);
    expect(ReorderVehiclePhotosRequestSchema.safeParse({ photoIds: [a], primary: a }).success).toBe(
      false,
    );
    expect(ReorderVehiclePhotosRequestSchema.safeParse({ photoIds: [] }).success).toBe(false);
  });
});
