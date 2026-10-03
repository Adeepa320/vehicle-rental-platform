import { UpdateVehicleRequestSchema, type Vehicle } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import { EMPTY_VEHICLE_FORM, fromVehicle, toVehiclePatch } from '../vehicle-form';
import { colomboDateToInstant, instantToColomboDate } from '../vehicle-labels';

const LOCATION = '0192f0a0-0000-7000-8000-000000000011';

const vehicle = {
  categoryId: 'car',
  locationId: LOCATION,
  title: 'Toyota Aqua 2018',
  internalName: null,
  make: 'Toyota',
  model: 'Aqua',
  modelYear: 2018,
  transmission: 'automatic',
  fuelType: 'hybrid',
  seats: 5,
  doors: 5,
  luggageCapacity: null,
  engineCc: 1500,
  hasAc: true,
  color: null,
  registrationNumber: 'CAB-1234',
  description: 'Clean, well-serviced hybrid hatchback ideal for the coast road.',
  dailyRate: '7500.00',
  weeklyRate: '45000.00',
  monthlyRate: null,
  securityDeposit: '25000.00',
  includedKmPerDay: 100,
  extraKmRate: '40.00',
  minRentalDays: 1,
  maxRentalDays: 30,
  minRenterAge: 21,
  minLicenceYears: null,
  fuelPolicy: 'full_to_full',
  deliveryAvailable: true,
  deliveryFee: null,
  pickupNotes: null,
} as unknown as Vehicle;

describe('vehicle form conversion', () => {
  it('produces a valid minimal patch from the blank form', () => {
    const patch = toVehiclePatch(EMPTY_VEHICLE_FORM);
    expect(UpdateVehicleRequestSchema.safeParse(patch).success).toBe(true);
    expect(patch).toMatchObject({
      hasAc: false,
      deliveryAvailable: false,
      minRentalDays: 1,
      includedKmPerDay: null,
      extraKmRate: null,
      deliveryFee: null,
    });
    expect(patch.dailyRate).toBeUndefined();
    expect(patch.categoryId).toBeUndefined();
  });

  it('round-trips a vehicle without losing or inventing fields', () => {
    const form = fromVehicle(vehicle);
    expect(form.unlimitedKm).toBe(false);
    expect(form.modelYear).toBe('2018');
    expect(form.deliveryFee).toBe('');
    const patch = UpdateVehicleRequestSchema.parse(toVehiclePatch(form));
    expect(patch).toEqual({
      categoryId: 'car',
      locationId: LOCATION,
      title: 'Toyota Aqua 2018',
      internalName: null,
      make: 'Toyota',
      model: 'Aqua',
      modelYear: 2018,
      transmission: 'automatic',
      fuelType: 'hybrid',
      seats: 5,
      doors: 5,
      luggageCapacity: null,
      engineCc: 1500,
      hasAc: true,
      color: null,
      registrationNumber: 'CAB-1234',
      description: 'Clean, well-serviced hybrid hatchback ideal for the coast road.',
      dailyRate: '7500.00',
      weeklyRate: '45000.00',
      monthlyRate: null,
      securityDeposit: '25000.00',
      includedKmPerDay: 100,
      extraKmRate: '40.00',
      minRentalDays: 1,
      maxRentalDays: 30,
      minRenterAge: 21,
      minLicenceYears: null,
      fuelPolicy: 'full_to_full',
      deliveryAvailable: true,
      deliveryFee: null,
      pickupNotes: null,
    });
  });

  it('omits identity fields in operational mode and nulls kilometre fields when unlimited', () => {
    const form = {
      ...fromVehicle(vehicle),
      unlimitedKm: true,
      deliveryAvailable: false,
      deliveryFee: '1500',
    };
    const patch = toVehiclePatch(form, 'operational');
    for (const locked of [
      'categoryId',
      'make',
      'model',
      'modelYear',
      'registrationNumber',
      'transmission',
      'hasAc',
    ]) {
      expect(patch, locked).not.toHaveProperty(locked);
    }
    expect(patch).toMatchObject({
      includedKmPerDay: null,
      extraKmRate: null,
      deliveryFee: null,
      dailyRate: '7500.00',
    });
  });

  it('never emits status, ownership or review fields', () => {
    const keys = Object.keys(toVehiclePatch(fromVehicle(vehicle)));
    for (const forbidden of [
      'status',
      'providerId',
      'reviewReason',
      'adminNotes',
      'approvedAt',
      'id',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('converts Sri Lanka dates to instants and back', () => {
    expect(colomboDateToInstant('2026-11-05')).toBe('2026-11-05T00:00:00+05:30');
    expect(instantToColomboDate('2026-11-04T18:30:00Z')).toBe('2026-11-05');
    expect(instantToColomboDate('2026-11-04T18:29:59Z')).toBe('2026-11-04');
  });
});
