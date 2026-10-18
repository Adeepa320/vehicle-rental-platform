import fs from 'node:fs';
import path from 'node:path';

import type {
  PlaceSummary,
  ProviderApplication,
  ProviderLocation,
  ProviderProfile,
  Vehicle,
} from '@vrp/contracts';

import { registerVerifiedUser } from './accounts';
import { call } from './api';
import type { ProviderAccount } from './world';

export const PROVIDER_PHONE = '+94771234567';

/** The seed gazetteer entry the whole suite searches for. */
export async function mirissaPlace(): Promise<PlaceSummary> {
  const { body } = await call<PlaceSummary[]>('GET', '/reference/places?districtId=matara');
  const place = body.find((p) => p.slug === 'mirissa');
  if (!place) throw new Error('seed place "mirissa" is missing; run pnpm db:seed');
  return place;
}

/**
 * Registers a user, submits a complete provider application, has the admin
 * approve it and adds one pickup location in Mirissa.
 */
export async function createApprovedProvider(
  adminToken: string,
  label: string,
  displayName: string,
): Promise<ProviderAccount> {
  const contactName = `E2E ${label} contact`;
  const user = await registerVerifiedUser(label, `E2E ${label}`);
  const mirissa = await mirissaPlace();
  await call('PUT', '/providers/me/application', {
    token: user.accessToken,
    body: {
      displayName,
      providerType: 'individual',
      contactName,
      phone: PROVIDER_PHONE,
      whatsapp: PROVIDER_PHONE,
      addressText: '12 Beach Road, Mirissa',
      districtId: 'matara',
      primaryPlaceId: mirissa.id,
      description:
        'Browser end-to-end test rental business serving Mirissa and Weligama with cars and vans.',
      vehicleCategoryIds: ['car'],
      yearsOperating: 6,
      fleetSizeEstimate: 4,
      offersDelivery: true,
      offersAirportTransfer: false,
    },
  });
  const application = await call<ProviderApplication>('POST', '/providers/me/application/submit', {
    token: user.accessToken,
    body: { acceptProviderAgreement: true },
  });
  await call('POST', `/admin/provider-applications/${application.body.id}/approve`, {
    token: adminToken,
    body: {},
  });
  const profile = await call<ProviderProfile>('GET', '/providers/me', { token: user.accessToken });
  const location = await call<ProviderLocation>('POST', '/providers/me/locations', {
    token: user.accessToken,
    body: {
      name: `${displayName} office`,
      districtId: 'matara',
      placeId: mirissa.id,
      addressText: '12 Beach Road, Mirissa 81740',
      point: { lat: 5.9485, lng: 80.4718 },
      pickupInstructions: 'Blue gate opposite the fish market.',
    },
    expect: 201,
  });
  return {
    ...user,
    providerId: profile.body.id,
    displayName,
    contactName,
    phone: PROVIDER_PHONE,
    locationId: location.body.id,
  };
}

const PHOTOS = [1, 2, 3].map((n) => path.join(__dirname, 'assets', `vehicle-photo-${n}.jpg`));

export async function uploadVehiclePhotos(token: string, vehicleId: string): Promise<void> {
  for (const file of PHOTOS) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }),
      path.basename(file),
    );
    await call('POST', `/providers/me/vehicles/${vehicleId}/photos`, {
      token,
      form,
      expect: 201,
    });
  }
}

export interface VehicleOptions {
  title: string;
  /** Unique-ish daily rate so the search filter can single the listing out. */
  dailyRate: string;
  categoryId?: string;
}

export interface ApprovedVehicle {
  id: string;
  slug: string;
  title: string;
  dailyRate: string;
  registrationNumber: string;
}

export function vehiclePayload(locationId: string, options: VehicleOptions) {
  const plate = `CAB-${Date.now().toString().slice(-4)}`;
  return {
    categoryId: options.categoryId ?? 'car',
    locationId,
    title: options.title,
    make: 'Toyota',
    model: 'Aqua',
    modelYear: 2018,
    transmission: 'automatic',
    fuelType: 'hybrid',
    seats: 5,
    doors: 5,
    luggageCapacity: 2,
    engineCc: 1500,
    hasAc: true,
    color: 'White',
    registrationNumber: plate,
    description: 'Clean, well-serviced hybrid hatchback ideal for the coast road.',
    dailyRate: options.dailyRate,
    weeklyRate: '45000',
    monthlyRate: '150000',
    securityDeposit: '25000',
    includedKmPerDay: 100,
    extraKmRate: '40',
    minRentalDays: 1,
    maxRentalDays: 30,
    minRenterAge: 21,
    minLicenceYears: 1,
    fuelPolicy: 'full_to_full',
    deliveryAvailable: true,
    deliveryFee: '1500',
    pickupNotes: 'Pickup from 8am.',
  };
}

/** Creates a complete car listing with three photos, submits it and has the admin approve it. */
export async function createApprovedVehicle(
  provider: ProviderAccount,
  adminToken: string,
  options: VehicleOptions,
): Promise<ApprovedVehicle> {
  const created = await call<Vehicle>('POST', '/providers/me/vehicles', {
    token: provider.accessToken,
    body: vehiclePayload(provider.locationId, options),
    expect: 201,
  });
  await uploadVehiclePhotos(provider.accessToken, created.body.id);
  await call('POST', `/providers/me/vehicles/${created.body.id}/submit`, {
    token: provider.accessToken,
    body: {},
  });
  const approved = await call<{ slug: string }>(
    'POST',
    `/admin/vehicles/${created.body.id}/approve`,
    {
      token: adminToken,
      body: {},
    },
  );
  return {
    id: created.body.id,
    slug: approved.body.slug,
    title: options.title,
    dailyRate: options.dailyRate,
    registrationNumber: created.body.registrationNumber as string,
  };
}

/** A daily rate that is very unlikely to collide with listings from other runs (LKR 7,001–9,999). */
export function uniqueDailyRate(): string {
  return String(7001 + Math.floor(Math.random() * 2999));
}
