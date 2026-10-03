import type { NestExpressApplication } from '@nestjs/platform-express';
import { MAX_PHOTO_BYTES, MAX_VEHICLE_PHOTOS, VehiclePhotoSchema } from '@vrp/contracts';
import { runMigrations } from '@vrp/database';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MemoryStorageProvider } from '../src/modules/storage/memory-storage.provider';
import { StorageService } from '../src/modules/storage/storage.service';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  newAdmin,
  newVerifiedUser,
  seedReference,
  type ApplicantSession,
  type ReferenceIds,
} from './utils/provider-helpers';
import {
  approvedProvider,
  completeVehicle,
  createVehicle,
  newLocation,
  testImage,
  uploadPhoto,
  uploadTestPhotos,
  vehicleAction,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping vehicle photo e2e tests');

const SCOPE = 'ppho';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe.skipIf(!url)('vehicle photos (upload, processing, ownership)', () => {
  let app: NestExpressApplication;
  let storage: MemoryStorageProvider;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let locationId: string;
  let plateCounter = 5000;
  const nextPlate = () => `PH-${(plateCounter += 1)}`;

  const photosOf = (token: string, vehicleId: string, expected = 200) =>
    request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${vehicleId}/photos`)
      .set(auth(token))
      .expect(expected);

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    storage = app.get(StorageService).provider as MemoryStorageProvider;
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin);
    locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('accepts a real JPEG, stores the original privately and three metadata-free WebP variants publicly', async () => {
    const token = provider.body.accessToken;
    const vehicle = await createVehicle(app, token, { categoryId: 'car' });
    const uploaded = await uploadPhoto(
      app,
      token,
      vehicle.body.id,
      await testImage({ width: 1200, height: 900 }),
    );
    expect(VehiclePhotoSchema.safeParse(uploaded.body).success).toBe(true);
    expect(uploaded.body).toMatchObject({
      sortOrder: 0,
      isPrimary: true,
      width: 1200,
      height: 900,
    });
    const prefix = `vehicles/${vehicle.body.id}/${uploaded.body.id}`;
    expect(uploaded.body.variants.thumb).toBe(
      `http://storage.test/vrp-public/${prefix}/thumb.webp`,
    );

    expect(storage.keys('private')).toContain(`${prefix}/original.jpg`);
    for (const [name, maxSide] of [
      ['thumb', 400],
      ['medium', 1000],
      ['large', 1600],
    ] as const) {
      const bytes = await storage.get('public', `${prefix}/${name}.webp`);
      expect(bytes, name).not.toBeNull();
      const meta = await sharp(bytes as Buffer).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(maxSide);
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
    const list = await photosOf(token, vehicle.body.id);
    expect(list.body).toHaveLength(1);
    const view = await request(app.getHttpServer())
      .get(`/api/v1/providers/me/vehicles/${vehicle.body.id}`)
      .set(auth(token))
      .expect(200);
    expect(view.body.photos).toHaveLength(1);
    expect(view.body.submissionIssues.map((i: { field: string }) => i.field)).toContain('photos');
  });

  it('applies EXIF orientation and strips the tag', async () => {
    const token = provider.body.accessToken;
    const vehicle = await createVehicle(app, token, { categoryId: 'car' });
    const rotated = await testImage({ width: 800, height: 600, orientation: 6 });
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const uploaded = await uploadPhoto(app, token, vehicle.body.id, rotated);
    // 6 = rotate 90° clockwise → the visual image is portrait.
    expect(uploaded.body).toMatchObject({ width: 600, height: 800 });
    const large = await storage.get(
      'public',
      `vehicles/${vehicle.body.id}/${uploaded.body.id}/large.webp`,
    );
    const meta = await sharp(large as Buffer).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(800);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it('rejects non-images, SVG, executables, oversized and tiny uploads, and missing files', async () => {
    const token = provider.body.accessToken;
    const vehicle = await createVehicle(app, token, { categoryId: 'car' });
    const text = await uploadPhoto(
      app,
      token,
      vehicle.body.id,
      Buffer.from('hello, not an image'),
      415,
    );
    expect(text.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await uploadPhoto(app, token, vehicle.body.id, svg, 415, 'logo.svg', 'image/svg+xml');
    // Declared as JPEG, actually SVG: the bytes decide.
    await uploadPhoto(app, token, vehicle.body.id, svg, 415, 'logo.jpg', 'image/jpeg');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 0x90)]);
    await uploadPhoto(app, token, vehicle.body.id, exe, 415, 'photo.jpg', 'image/jpeg');
    const huge = await uploadPhoto(
      app,
      token,
      vehicle.body.id,
      Buffer.alloc(MAX_PHOTO_BYTES + 1),
      413,
    );
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const tiny = await uploadPhoto(
      app,
      token,
      vehicle.body.id,
      await testImage({ width: 100, height: 100 }),
      400,
    );
    expect(tiny.body.error.details[0].issue).toMatch(/at least/);
    await request(app.getHttpServer())
      .post(`/api/v1/providers/me/vehicles/${vehicle.body.id}/photos`)
      .set(auth(token))
      .expect(400);
    expect((await photosOf(token, vehicle.body.id)).body).toHaveLength(0);
    expect(storage.keys('private').filter((k) => k.includes(vehicle.body.id))).toHaveLength(0);
  });

  it('keeps photos private to the owning provider and closed to customers', async () => {
    const token = provider.body.accessToken;
    const vehicle = await createVehicle(app, token, { categoryId: 'car' });
    const mine = await uploadPhoto(app, token, vehicle.body.id, await testImage());
    const other = await approvedProvider(app, nextEmail(), refs, admin, 'Other Fleet');
    const otherToken = other.body.accessToken;
    await uploadPhoto(app, otherToken, vehicle.body.id, await testImage(), 404);
    await photosOf(otherToken, vehicle.body.id, 404);
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/vehicles/${vehicle.body.id}/photos/${mine.body.id}`)
      .set(auth(otherToken))
      .expect(404);
    const customer = await newVerifiedUser(app, nextEmail());
    await uploadPhoto(app, customer.body.accessToken, vehicle.body.id, await testImage(), 403);
    expect((await photosOf(token, vehicle.body.id)).body).toHaveLength(1);
  });

  it('enforces the photo limit, reorders with a full id list and renumbers after deletion', async () => {
    const token = provider.body.accessToken;
    const vehicle = await createVehicle(app, token, { categoryId: 'car' });
    await uploadTestPhotos(app, token, vehicle.body.id, MAX_VEHICLE_PHOTOS);
    const full = await uploadPhoto(app, token, vehicle.body.id, await testImage(), 409);
    expect(full.body.error.code).toBe('CONFLICT');

    const photos = (await photosOf(token, vehicle.body.id)).body as {
      id: string;
      sortOrder: number;
    }[];
    expect(photos.map((p) => p.sortOrder)).toEqual([...Array(MAX_VEHICLE_PHOTOS).keys()]);
    const reversed = [...photos].reverse().map((p) => p.id);
    const reordered = await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/vehicles/${vehicle.body.id}/photos/order`)
      .set(auth(token))
      .send({ photoIds: reversed })
      .expect(200);
    expect(reordered.body[0]).toMatchObject({ id: reversed[0], isPrimary: true, sortOrder: 0 });
    const partial = await request(app.getHttpServer())
      .patch(`/api/v1/providers/me/vehicles/${vehicle.body.id}/photos/order`)
      .set(auth(token))
      .send({ photoIds: reversed.slice(1) })
      .expect(400);
    expect(partial.body.error.details[0].field).toBe('photoIds');

    const removedId = reversed[0] as string;
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/vehicles/${vehicle.body.id}/photos/${removedId}`)
      .set(auth(token))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/providers/me/vehicles/${vehicle.body.id}/photos/${removedId}`)
      .set(auth(token))
      .expect(404);
    const after = (await photosOf(token, vehicle.body.id)).body as {
      id: string;
      sortOrder: number;
    }[];
    expect(after).toHaveLength(MAX_VEHICLE_PHOTOS - 1);
    expect(after.map((p) => p.sortOrder)).toEqual([...Array(MAX_VEHICLE_PHOTOS - 1).keys()]);
    expect(after[0]?.id).toBe(reversed[1]);
    expect(storage.keys('public').filter((k) => k.includes(removedId))).toHaveLength(0);
    expect(storage.keys('private').filter((k) => k.includes(removedId))).toHaveLength(0);
  });

  it('requires three photos to submit and locks photos once submitted', async () => {
    const token = provider.body.accessToken;
    const vehicle = await createVehicle(
      app,
      token,
      completeVehicle(locationId, { registrationNumber: nextPlate() }),
    );
    await uploadTestPhotos(app, token, vehicle.body.id, 2);
    const refused = await vehicleAction(app, token, vehicle.body.id, 'submit', 400);
    expect(refused.body.error.details).toEqual([
      { field: 'photos', issue: 'at least 3 photos are required (2 uploaded)' },
    ]);
    await uploadTestPhotos(app, token, vehicle.body.id, 1);
    const submitted = await vehicleAction(app, token, vehicle.body.id, 'submit');
    expect(submitted.body.status).toBe('submitted');
    expect(submitted.body.photos).toHaveLength(3);
    const locked = await uploadPhoto(app, token, vehicle.body.id, await testImage(), 409);
    expect(locked.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await request(app.getHttpServer())
      .delete(
        `/api/v1/providers/me/vehicles/${vehicle.body.id}/photos/${submitted.body.photos[0].id}`,
      )
      .set(auth(token))
      .expect(409);
    // Still readable.
    expect((await photosOf(token, vehicle.body.id)).body).toHaveLength(3);
  });
});
