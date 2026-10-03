import { describe, expect, it } from 'vitest';

import {
  AvailabilityRangeQuerySchema,
  CreateAvailabilityBlockRequestSchema,
  CreateProviderLocationRequestSchema,
  CreateVehicleRequestSchema,
  LkrAmountSchema,
  RegistrationNumberSchema,
  UpdateProviderLocationRequestSchema,
  UpdateVehicleRequestSchema,
  amountToCents,
  compareAmounts,
  formatLkr,
  maskRegistrationNumber,
  multiplyAmount,
  normalizeAmount,
  vehicleSubmissionIssues,
} from '../index';

const LOCATION = '0192f0a0-0000-7000-8000-000000000011';

const completeCar = {
  categoryId: 'car',
  locationId: LOCATION,
  title: 'Toyota Aqua 2018 – automatic hybrid',
  internalName: null,
  make: 'Toyota',
  model: 'Aqua',
  modelYear: 2018,
  transmission: 'automatic' as const,
  fuelType: 'hybrid' as const,
  seats: 5,
  doors: 5,
  luggageCapacity: 2,
  engineCc: 1500,
  hasAc: true,
  color: 'White',
  registrationNumber: 'CAB-1234',
  description: 'Clean, well-serviced hybrid hatchback ideal for the coast road.',
  dailyRate: '7500',
  weeklyRate: '45000',
  monthlyRate: '150000',
  securityDeposit: '25000',
  includedKmPerDay: 100,
  extraKmRate: '40',
  minRentalDays: 1,
  maxRentalDays: 30,
  minRenterAge: 21,
  minLicenceYears: 1,
  fuelPolicy: 'full_to_full' as const,
  deliveryAvailable: true,
  deliveryFee: '1500',
  pickupNotes: null,
};

describe('money', () => {
  it('parses, normalises and compares decimal strings without floats', () => {
    expect(amountToCents('7500')).toBe(750000n);
    expect(amountToCents('7500.5')).toBe(750050n);
    expect(normalizeAmount('7500')).toBe('7500.00');
    expect(normalizeAmount('0.1')).toBe('0.10');
    expect(compareAmounts('100.00', '99.99')).toBe(1);
    expect(compareAmounts('1', '1.00')).toBe(0);
    expect(multiplyAmount('7500.50', 7)).toBe('52503.50');
    expect(formatLkr('1234567.5')).toBe('LKR 1,234,567.50');
    expect(formatLkr('7500.00')).toBe('LKR 7,500');
  });

  it('rejects floats, negatives, exponents and more than two decimals', () => {
    for (const bad of ['-5', '1e3', '12.345', 'abc', '', '01', '1,000']) {
      expect(LkrAmountSchema.safeParse(bad).success, bad).toBe(false);
    }
    for (const good of ['0', '500', '7500.5', '1000000.00']) {
      expect(LkrAmountSchema.safeParse(good).success, good).toBe(true);
    }
  });
});

describe('provider locations', () => {
  it('requires district, place and address; coordinates must be inside Sri Lanka', () => {
    const base = {
      name: 'Mirissa office',
      districtId: 'matara',
      placeId: LOCATION,
      addressText: '12 Beach Road',
    };
    expect(CreateProviderLocationRequestSchema.safeParse(base).success).toBe(true);
    expect(
      CreateProviderLocationRequestSchema.safeParse({
        ...base,
        point: { lat: 5.9485, lng: 80.4718 },
      }).success,
    ).toBe(true);
    expect(
      CreateProviderLocationRequestSchema.safeParse({ ...base, point: { lat: 51.5, lng: -0.12 } })
        .success,
    ).toBe(false);
    expect(
      CreateProviderLocationRequestSchema.safeParse({ ...base, providerId: LOCATION }).success,
    ).toBe(false);
    expect(UpdateProviderLocationRequestSchema.safeParse({ isPrimary: true }).success).toBe(true);
    expect(UpdateProviderLocationRequestSchema.safeParse({ geom: 'POINT(1 1)' }).success).toBe(
      false,
    );
  });
});

describe('vehicles', () => {
  it('creates a draft from a category only and rejects status/provider/admin fields', () => {
    expect(CreateVehicleRequestSchema.safeParse({ categoryId: 'car' }).success).toBe(true);
    expect(CreateVehicleRequestSchema.safeParse({ title: 'No category' }).success).toBe(false);
    for (const injected of [
      { status: 'approved' },
      { providerId: LOCATION },
      { adminNotes: 'x' },
      { reviewReason: 'x' },
      { approvedAt: new Date().toISOString() },
    ]) {
      expect(
        CreateVehicleRequestSchema.safeParse({ categoryId: 'car', ...injected }).success,
        JSON.stringify(injected),
      ).toBe(false);
    }
  });

  it('normalises registration numbers and rejects nonsense', () => {
    expect(RegistrationNumberSchema.parse(' cab-1234 ')).toBe('CAB-1234');
    expect(RegistrationNumberSchema.parse('wp cab-1234')).toBe('WP CAB-1234');
    expect(RegistrationNumberSchema.parse('15-1234')).toBe('15-1234');
    for (const bad of ['CAB-12', 'ABCD-1234', 'CAB 1234 X', '<script>']) {
      expect(RegistrationNumberSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(maskRegistrationNumber('WP CAB-1234')).toBe('WP CAB-••34');
  });

  it('checks pricing consistency on drafts whenever both sides are present', () => {
    const issues = (patch: Record<string, unknown>) =>
      UpdateVehicleRequestSchema.safeParse(patch).error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(issues({ dailyRate: '7500', weeklyRate: '60000' })).toEqual(['weeklyRate']);
    expect(issues({ dailyRate: '7500', weeklyRate: '7000' })).toEqual(['weeklyRate']);
    expect(issues({ dailyRate: '7500', monthlyRate: '300000' })).toEqual(['monthlyRate']);
    expect(issues({ includedKmPerDay: 100 })).toEqual(['extraKmRate']);
    expect(issues({ minRentalDays: 5, maxRentalDays: 3 })).toEqual(['maxRentalDays']);
    expect(issues({ deliveryAvailable: false, deliveryFee: '1500' })).toEqual(['deliveryFee']);
    expect(issues({ dailyRate: '100' })).toEqual(['dailyRate']); // below the sanity floor
    expect(issues({ dailyRate: '7500', weeklyRate: '45000', monthlyRate: '150000' })).toEqual([]);
  });

  it('applies category rules: bikes have no doors or AC, cars need transmission/fuel/seats/doors', () => {
    expect(UpdateVehicleRequestSchema.safeParse({ categoryId: 'bike', doors: 2 }).success).toBe(
      false,
    );
    expect(UpdateVehicleRequestSchema.safeParse({ categoryId: 'bike', hasAc: true }).success).toBe(
      false,
    );
    expect(
      UpdateVehicleRequestSchema.safeParse({ categoryId: 'bike', hasAc: false, engineCc: 150 })
        .success,
    ).toBe(true);

    const emptyCar = vehicleSubmissionIssues({ categoryId: 'car' }).map((i) => i.field);
    for (const field of [
      'locationId',
      'title',
      'make',
      'model',
      'registrationNumber',
      'dailyRate',
      'transmission',
      'doors',
    ]) {
      expect(emptyCar).toContain(field);
    }
    const bikeWithoutCc = vehicleSubmissionIssues({
      ...completeCar,
      categoryId: 'bike',
      doors: null,
      hasAc: false,
      engineCc: null,
    });
    expect(bikeWithoutCc.map((i) => i.field)).toEqual(['engineCc']);
    expect(vehicleSubmissionIssues(completeCar)).toEqual([]);
  });

  it('reports a pricing inconsistency at submission even when each field is valid alone', () => {
    const issues = vehicleSubmissionIssues({ ...completeCar, weeklyRate: '100000' });
    expect(issues).toEqual([
      { field: 'weeklyRate', issue: 'weekly rate cannot exceed 7 × the daily rate' },
    ]);
  });
});

describe('availability blocks', () => {
  it('requires end after start, caps the length and accepts timezone offsets', () => {
    const ok = CreateAvailabilityBlockRequestSchema.safeParse({
      startsAt: '2026-11-01T00:00:00+05:30',
      endsAt: '2026-11-05T00:00:00+05:30',
      reason: 'maintenance',
    });
    expect(ok.success).toBe(true);
    expect(
      CreateAvailabilityBlockRequestSchema.safeParse({
        startsAt: '2026-11-05T00:00:00Z',
        endsAt: '2026-11-05T00:00:00Z',
        reason: 'other',
      }).success,
    ).toBe(false);
    expect(
      CreateAvailabilityBlockRequestSchema.safeParse({
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2027-06-01T00:00:00Z',
        reason: 'other',
      }).success,
    ).toBe(false);
    expect(
      CreateAvailabilityBlockRequestSchema.safeParse({
        startsAt: '2026-11-01T00:00:00Z',
        endsAt: '2026-11-02T00:00:00Z',
        reason: 'holiday',
      }).success,
    ).toBe(false);
    expect(
      AvailabilityRangeQuerySchema.safeParse({
        from: '2026-01-01T00:00:00Z',
        to: '2027-06-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
