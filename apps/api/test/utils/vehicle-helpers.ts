import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AdminVehicle, ProviderLocation, Vehicle } from '@vrp/contracts';
import sharp from 'sharp';
import request, { type Response } from 'supertest';

import {
  adminAction,
  completeApplication,
  newVerifiedUser,
  saveDraft,
  submitApplication,
  type ApplicantSession,
  type ReferenceIds,
} from './provider-helpers';

export interface ProviderSession extends ApplicantSession {
  providerId: string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Registers a customer, submits an application and has `admin` approve it. */
export async function approvedProvider(
  app: NestExpressApplication,
  email: string,
  refs: ReferenceIds,
  admin: ApplicantSession,
  displayName = 'Sunil Rentals Mirissa',
): Promise<ProviderSession> {
  const user = await newVerifiedUser(app, email);
  await saveDraft(app, user.body.accessToken, { ...completeApplication(refs), displayName });
  const application = (await submitApplication(app, user.body.accessToken)).body as { id: string };
  await adminAction(app, admin.body.accessToken, application.id, 'approve');
  const profile = await request(app.getHttpServer())
    .get('/api/v1/providers/me')
    .set(auth(user.body.accessToken))
    .expect(200);
  return { ...user, providerId: profile.body.id as string };
}

export function locationPayload(refs: ReferenceIds, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Mirissa office',
    districtId: refs.districtId,
    placeId: refs.mirissaId,
    addressText: '12 Beach Road, Mirissa 81740',
    point: { lat: 5.9485, lng: 80.4718 },
    pickupInstructions: 'Blue gate opposite the fish market.',
    ...overrides,
  };
}

export async function createLocation(
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown>,
  expected = 201,
): Promise<Response> {
  return request(app.getHttpServer())
    .post('/api/v1/providers/me/locations')
    .set(auth(token))
    .send(body)
    .expect(expected);
}

export async function newLocation(
  app: NestExpressApplication,
  token: string,
  refs: ReferenceIds,
  overrides: Record<string, unknown> = {},
): Promise<ProviderLocation> {
  const response = await createLocation(app, token, locationPayload(refs, overrides));
  return response.body as ProviderLocation;
}

/** A complete, submittable car listing. */
export function completeVehicle(locationId: string, overrides: Record<string, unknown> = {}) {
  return {
    categoryId: 'car',
    locationId,
    title: 'Toyota Aqua 2018 – automatic hybrid',
    internalName: 'Aqua white',
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
    fuelPolicy: 'full_to_full',
    deliveryAvailable: true,
    deliveryFee: '1500',
    pickupNotes: 'Pickup from 8am.',
    ...overrides,
  };
}

export async function createVehicle(
  app: NestExpressApplication,
  token: string,
  body: Record<string, unknown>,
  expected = 201,
): Promise<Response> {
  return request(app.getHttpServer())
    .post('/api/v1/providers/me/vehicles')
    .set(auth(token))
    .send(body)
    .expect(expected);
}

export async function patchVehicle(
  app: NestExpressApplication,
  token: string,
  id: string,
  body: Record<string, unknown>,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .patch(`/api/v1/providers/me/vehicles/${id}`)
    .set(auth(token))
    .send(body)
    .expect(expected);
}

export async function vehicleAction(
  app: NestExpressApplication,
  token: string,
  id: string,
  action: 'submit' | 'deactivate' | 'activate',
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .post(`/api/v1/providers/me/vehicles/${id}/${action}`)
    .set(auth(token))
    .send({})
    .expect(expected);
}

export async function adminVehicleAction(
  app: NestExpressApplication,
  adminToken: string,
  id: string,
  action: 'start-review' | 'request-changes' | 'approve' | 'reject' | 'suspend' | 'reactivate',
  body: Record<string, unknown> = {},
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .post(`/api/v1/admin/vehicles/${id}/${action}`)
    .set(auth(adminToken))
    .send(body)
    .expect(expected);
}

/** Creates and submits a complete listing; returns the provider view. */
export async function submitCompleteVehicle(
  app: NestExpressApplication,
  token: string,
  locationId: string,
  overrides: Record<string, unknown> = {},
): Promise<Vehicle> {
  const created = await createVehicle(app, token, completeVehicle(locationId, overrides));
  await uploadTestPhotos(app, token, created.body.id as string, 3);
  const submitted = await vehicleAction(app, token, created.body.id as string, 'submit');
  return submitted.body as Vehicle;
}

/** Creates, submits and approves a listing; returns the provider view after approval. */
export async function approvedVehicle(
  app: NestExpressApplication,
  providerToken: string,
  adminToken: string,
  locationId: string,
  overrides: Record<string, unknown> = {},
): Promise<Vehicle> {
  const submitted = await submitCompleteVehicle(app, providerToken, locationId, overrides);
  await adminVehicleAction(app, adminToken, submitted.id, 'approve');
  const fresh = await request(app.getHttpServer())
    .get(`/api/v1/providers/me/vehicles/${submitted.id}`)
    .set(auth(providerToken))
    .expect(200);
  return fresh.body as Vehicle;
}

export async function blockRequest(
  app: NestExpressApplication,
  token: string,
  vehicleId: string,
  body: Record<string, unknown>,
  expected = 201,
): Promise<Response> {
  return request(app.getHttpServer())
    .post(`/api/v1/providers/me/vehicles/${vehicleId}/blocks`)
    .set(auth(token))
    .send(body)
    .expect(expected);
}

/** ISO instant `days` from now at 00:00 Asia/Colombo (+05:30). */
export function colomboMidnight(daysFromNow: number): string {
  const now = new Date();
  const colombo = new Date(now.getTime() + 5.5 * 3_600_000);
  const date = new Date(
    Date.UTC(colombo.getUTCFullYear(), colombo.getUTCMonth(), colombo.getUTCDate() + daysFromNow),
  );
  return `${date.toISOString().slice(0, 10)}T00:00:00+05:30`;
}

export type { AdminVehicle };

export interface TestImageOptions {
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp';
  /** EXIF orientation tag (JPEG only), e.g. 6 = rotate 90° clockwise. */
  orientation?: number;
}

/** Generates a real image in memory (no fixtures on disk). */
export async function testImage(options: TestImageOptions = {}): Promise<Buffer> {
  const { width = 800, height = 600, format = 'jpeg', orientation } = options;
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  });
  if (orientation) image = image.withMetadata({ orientation });
  return image.toFormat(format).toBuffer();
}

export async function uploadPhoto(
  app: NestExpressApplication,
  token: string,
  vehicleId: string,
  buffer: Buffer,
  expected = 201,
  filename = 'photo.jpg',
  contentType = 'image/jpeg',
): Promise<Response> {
  return request(app.getHttpServer())
    .post(`/api/v1/providers/me/vehicles/${vehicleId}/photos`)
    .set(auth(token))
    .attach('file', buffer, { filename, contentType })
    .expect(expected);
}

/** Uploads n distinct valid photos (the minimum for submission is 3). */
export async function uploadTestPhotos(
  app: NestExpressApplication,
  token: string,
  vehicleId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await uploadPhoto(app, token, vehicleId, await testImage({ width: 800 + i, height: 600 }));
  }
}
