import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AdminProviderApplication, ProviderApplication } from '@vrp/contracts';
import { places, runSeed, users, vehicleCategories, type DatabaseHandle } from '@vrp/database';
import { eq } from 'drizzle-orm';
import request, { type Response } from 'supertest';

import { grantRole } from '../../src/cli/grant-admin.js';
import { DATABASE_HANDLE } from '../../src/database/database.module';
import { login, registerAndVerify, type LoginResult } from './auth-helpers';

export interface ReferenceIds {
  districtId: 'matara';
  inactiveDistrictId: 'colombo';
  mirissaId: string;
  weligamaId: string;
  gallePlaceId: string;
  activeCategoryId: 'car';
  inactiveCategoryId: 'scooter';
}

/** Seeds reference data into the test database and returns the ids the tests need. */
export async function seedReference(app: INestApplicationContext): Promise<ReferenceIds> {
  const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  await runSeed(handle.db);
  const bySlug = async (slug: string) => {
    const [row] = await handle.db
      .select({ id: places.id })
      .from(places)
      .where(eq(places.slug, slug));
    if (!row) throw new Error(`seed place ${slug} missing`);
    return row.id;
  };
  const [scooter] = await handle.db
    .select({ id: vehicleCategories.id })
    .from(vehicleCategories)
    .where(eq(vehicleCategories.id, 'scooter'));
  if (!scooter) throw new Error('seed category scooter missing');
  return {
    districtId: 'matara',
    inactiveDistrictId: 'colombo',
    mirissaId: await bySlug('mirissa'),
    weligamaId: await bySlug('weligama'),
    gallePlaceId: await bySlug('galle'),
    activeCategoryId: 'car',
    inactiveCategoryId: 'scooter',
  };
}

export function completeApplication(refs: ReferenceIds) {
  return {
    displayName: 'Sunil Rentals Mirissa',
    providerType: 'individual' as const,
    contactName: 'Sunil Perera',
    phone: '+94771234567',
    whatsapp: '+94771234567',
    addressText: '12 Beach Road, Mirissa',
    districtId: refs.districtId,
    primaryPlaceId: refs.mirissaId,
    serviceAreaPlaceIds: [refs.weligamaId],
    description: 'Family-run scooter and car rental serving the Mirissa and Weligama surf beaches.',
    yearsOperating: 6,
    vehicleCategoryIds: [refs.activeCategoryId],
    fleetSizeEstimate: 8,
    offersDelivery: true,
    offersAirportTransfer: false,
    websiteUrl: 'https://sunil-rentals.example',
    applicantNotes: 'Open 7 days.',
  };
}

export interface ApplicantSession extends LoginResult {
  email: string;
  userId: string;
}

/** Registers, verifies and logs in a fresh customer. */
export async function newVerifiedUser(
  app: NestExpressApplication,
  email: string,
): Promise<ApplicantSession> {
  const { user } = await registerAndVerify(app, email);
  const session = await login(app, email);
  return { ...session, email, userId: user.id };
}

/** Registers a verified user and grants the admin role through the bootstrap function. */
export async function newAdmin(
  app: NestExpressApplication,
  email: string,
): Promise<ApplicantSession> {
  const { user } = await registerAndVerify(app, email);
  const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  await grantRole(handle.db, email, 'admin');
  const session = await login(app, email);
  return { ...session, email, userId: user.id };
}

export async function saveDraft(
  app: NestExpressApplication,
  accessToken: string,
  body: Record<string, unknown>,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .put('/api/v1/providers/me/application')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body)
    .expect(expected);
}

export async function submitApplication(
  app: NestExpressApplication,
  accessToken: string,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .post('/api/v1/providers/me/application/submit')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ acceptProviderAgreement: true })
    .expect(expected);
}

/** Drafts and submits a complete application; returns the applicant view. */
export async function submitCompleteApplication(
  app: NestExpressApplication,
  accessToken: string,
  refs: ReferenceIds,
): Promise<ProviderApplication> {
  await saveDraft(app, accessToken, completeApplication(refs));
  const response = await submitApplication(app, accessToken);
  return response.body as ProviderApplication;
}

export async function adminAction(
  app: NestExpressApplication,
  adminToken: string,
  applicationId: string,
  action: 'start-review' | 'request-changes' | 'approve' | 'reject',
  body: Record<string, unknown> = {},
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .post(`/api/v1/admin/provider-applications/${applicationId}/${action}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body)
    .expect(expected);
}

export async function rolesOf(app: INestApplicationContext, userId: string): Promise<string[]> {
  const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  const [row] = await handle.db
    .select({ roles: users.roles })
    .from(users)
    .where(eq(users.id, userId));
  return row?.roles ?? [];
}

export type { AdminProviderApplication };
