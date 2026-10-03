import type { NestExpressApplication } from '@nestjs/platform-express';
import { DistrictSchema, PlaceSummarySchema, VehicleCategorySchema } from '@vrp/contracts';
import { runMigrations } from '@vrp/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { seedReference } from './utils/provider-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping reference data e2e tests');

describe.skipIf(!url)('public reference data', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    await seedReference(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves districts with their active flag without authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reference/districts')
      .expect(200);
    expect(z.array(DistrictSchema).safeParse(response.body).success).toBe(true);
    expect(response.body).toHaveLength(25);
    expect(response.body.find((d: { id: string }) => d.id === 'matara')?.isActive).toBe(true);
    expect(response.body.find((d: { id: string }) => d.id === 'colombo')?.isActive).toBe(false);
  });

  it('filters places by district', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reference/places?districtId=matara')
      .expect(200);
    expect(z.array(PlaceSummarySchema).safeParse(response.body).success).toBe(true);
    const slugs = response.body.map((p: { slug: string }) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(['matara', 'mirissa', 'weligama']));
    expect(slugs).not.toContain('galle');
    await request(app.getHttpServer())
      .get('/api/v1/reference/places?districtId=Bad%20Id')
      .expect(400);
  });

  it('lists only active vehicle categories', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reference/vehicle-categories')
      .expect(200);
    expect(z.array(VehicleCategorySchema).safeParse(response.body).success).toBe(true);
    const ids = response.body.map((c: { id: string }) => c.id);
    expect(ids).toEqual(['car', 'suv', 'van', 'bike']);
  });
});
