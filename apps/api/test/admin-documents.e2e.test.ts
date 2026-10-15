import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminDocumentListSchema,
  AdminDocumentSchema,
  MAX_DOCUMENT_BYTES,
  ProviderDocumentSchema,
  type AdminDocument,
  type ProviderDocument,
} from '@vrp/contracts';
import {
  auditEvents,
  notifications,
  runMigrations,
  vehicles,
  verificationDocuments,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDays, colomboDay } from '../src/common/colombo-dates';
import { DATABASE_HANDLE } from '../src/database/database.module';
import { DocumentExpiryService } from '../src/modules/documents/document-expiry.service';
import type { MemoryStorageProvider } from '../src/modules/storage/memory-storage.provider';
import { StorageService } from '../src/modules/storage/storage.service';
import { cleanupUsers, emailFactory, takeAllEmails } from './utils/auth-helpers';
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
  approvedVehicle,
  newLocation,
  testImage,
  type ProviderSession,
} from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping document verification e2e tests');

const SCOPE = 'adoc';
const nextEmail = emailFactory(SCOPE);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);

describe.skipIf(!url)('private verification documents (Phase 9)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let storage: MemoryStorageProvider;
  let expiry: DocumentExpiryService;
  let refs: ReferenceIds;
  let admin: ApplicantSession;
  let provider: ProviderSession;
  let other: ProviderSession;
  let vehicleId: string;
  let vehicleSlug: string;

  const api = () => request(app.getHttpServer());
  const upload = (
    token: string,
    fields: Record<string, string>,
    file: Buffer,
    filename = 'doc.pdf',
    contentType = 'application/pdf',
  ) => {
    let req = api().post('/api/v1/providers/me/documents').set(auth(token));
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return req.attach('file', file, { filename, contentType });
  };
  const uploaded = async (token: string, fields: Record<string, string>, file: Buffer = PDF) => {
    const res = await upload(token, fields, file).expect(201);
    expect(ProviderDocumentSchema.safeParse(res.body).success).toBe(true);
    return res.body as ProviderDocument;
  };
  const approve = async (id: string, body: Record<string, unknown> = {}) => {
    const res = await api()
      .post(`/api/v1/admin/documents/${id}/approve`)
      .set(auth(admin.body.accessToken))
      .send(body)
      .expect(200);
    expect(AdminDocumentSchema.safeParse(res.body).success).toBe(true);
    return res.body as AdminDocument;
  };
  const searchCards = async () =>
    (
      await api()
        .get('/api/v1/vehicles/search')
        .query({ placeId: refs.mirissaId, limit: 50 })
        .expect(200)
    ).body.data as {
      id: string;
      documentsVerified: boolean;
      provider: { documentsVerified: boolean };
    }[];
  const auditActions = (targetId: string) =>
    handle.db
      .select({ action: auditEvents.action, actorUserId: auditEvents.actorUserId })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'document'), eq(auditEvents.targetId, targetId)));

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    storage = app.get(StorageService).provider as MemoryStorageProvider;
    expiry = app.get(DocumentExpiryService);
    refs = await seedReference(app);
    admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Docs Rentals Mirissa');
    other = await approvedProvider(app, nextEmail(), refs, admin, 'Other Docs Rentals');
    const locationId = (await newLocation(app, provider.body.accessToken, refs)).id;
    const vehicle = await approvedVehicle(
      app,
      provider.body.accessToken,
      admin.body.accessToken,
      locationId,
      {
        registrationNumber: 'DC-2001',
      },
    );
    vehicleId = vehicle.id;
    vehicleSlug = vehicle.slug as string;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('accepts PDF / JPEG / PNG by content and refuses mislabelled, oversized and foreign files', async () => {
    const token = provider.body.accessToken;
    const pdf = await uploaded(token, { type: 'identity_document' });
    expect(pdf).toMatchObject({
      scope: 'provider',
      type: 'identity_document',
      status: 'pending',
      mimeType: 'application/pdf',
      vehicleId: null,
    });
    expect(JSON.stringify(pdf)).not.toMatch(/storageKey|documents\/|sha256/);
    const jpeg = await uploaded(
      token,
      { type: 'certificate_of_registration', vehicleId },
      await testImage(),
    );
    expect(jpeg.mimeType).toBe('image/jpeg');
    const png = await uploaded(
      token,
      { type: 'revenue_licence', vehicleId, expiresOn: addDays(colomboDay(), 200) },
      await testImage({ format: 'png' }),
    );
    expect(png.mimeType).toBe('image/png');
    // Declared type is ignored: an SVG labelled as PNG, text labelled as PDF, a PNG header with JPEG body.
    await upload(
      token,
      { type: 'insurance_certificate', vehicleId },
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'x.png',
      'image/png',
    ).expect(415);
    await upload(
      token,
      { type: 'insurance_certificate', vehicleId },
      Buffer.from('hello world'),
      'x.pdf',
      'application/pdf',
    ).expect(415);
    await upload(
      token,
      { type: 'insurance_certificate', vehicleId },
      Buffer.from('<html><script>alert(1)</script></html>'),
      'x.html',
      'text/html',
    ).expect(415);
    await upload(
      token,
      { type: 'insurance_certificate', vehicleId },
      Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x25),
      'big.pdf',
      'application/pdf',
    ).expect(413);
    // Vehicle types need the vehicle; provider types must not name one; foreign vehicles are 404.
    await upload(token, { type: 'insurance_certificate' }, PDF).expect(400);
    await upload(token, { type: 'identity_document', vehicleId }, PDF).expect(400);
    await upload(other.body.accessToken, { type: 'insurance_certificate', vehicleId }, PDF).expect(
      404,
    );
    // Stored privately under a server key; nothing in the public bucket.
    expect(
      storage.keys('private').some((k) => k.startsWith(`documents/${provider.providerId}/`)),
    ).toBe(true);
    expect(storage.keys('public').some((k) => k.startsWith('documents/'))).toBe(false);
  });

  it('scopes reads to the owner and audits every admin download', async () => {
    const mine = (
      await api()
        .get('/api/v1/providers/me/documents')
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body.data as ProviderDocument[];
    expect(mine.length).toBeGreaterThanOrEqual(3);
    const doc = mine.find((d) => d.type === 'identity_document') as ProviderDocument;
    const own = await api()
      .get(`/api/v1/providers/me/documents/${doc.id}/content`)
      .set(auth(provider.body.accessToken))
      .expect(200);
    expect(own.headers['content-type']).toContain('application/pdf');
    expect(own.headers['content-disposition']).toContain('attachment');
    await api()
      .get(`/api/v1/providers/me/documents/${doc.id}/content`)
      .set(auth(other.body.accessToken))
      .expect(404);
    await api()
      .get(`/api/v1/admin/documents/${doc.id}/content`)
      .set(auth(provider.body.accessToken))
      .expect(403);
    await api().get(`/api/v1/admin/documents/${doc.id}/content`).expect(401);
    const asAdmin = await api()
      .get(`/api/v1/admin/documents/${doc.id}/content`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(asAdmin.headers['cache-control']).toContain('no-store');
    expect((await auditActions(doc.id)).filter((a) => a.action === 'document.viewed')).toEqual([
      expect.objectContaining({ actorUserId: admin.userId }),
    ]);
    // No public route ever serves a document or its key.
    const detail = await api().get(`/api/v1/vehicles/${vehicleSlug}`).expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/documents\/|storageKey|content/);
  });

  it('reviews documents (approve with expiry, reject, request replacement) with notifications and badges', async () => {
    const queue = await api()
      .get('/api/v1/admin/documents')
      .query({ status: 'pending', vehicleId })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(AdminDocumentListSchema.safeParse(queue.body).success).toBe(true);
    const byType = new Map((queue.body.data as AdminDocument[]).map((d) => [d.type, d]));
    const cr = byType.get('certificate_of_registration') as AdminDocument;
    const licence = byType.get('revenue_licence') as AdminDocument;
    expect(cr.daysUntilExpiry).toBeNull();
    await takeAllEmails(app);

    const approvedCr = await approve(cr.id, { note: 'Matches the plate' });
    expect(approvedCr).toMatchObject({
      status: 'approved',
      effectiveStatus: 'approved',
      reviewedBy: admin.userId,
    });
    const futureExpiry = addDays(colomboDay(), 120);
    const approvedLicence = await approve(licence.id, { expiresOn: futureExpiry });
    expect(approvedLicence.expiresOn).toBe(futureExpiry);
    expect(approvedLicence.daysUntilExpiry).toBe(120);
    const mails = await takeAllEmails(app);
    expect(
      mails.filter((m) => m.to === provider.email && m.subject.includes('approved')).length,
    ).toBe(2);
    const inApp = await handle.db
      .select({ type: notifications.type })
      .from(notifications)
      .where(eq(notifications.userId, provider.userId));
    expect(inApp.map((n) => n.type)).toContain('document.approved');

    // Not verified yet: insurance missing.
    let vehicleCard = (await searchCards()).find((c) => c.id === vehicleId);
    expect(vehicleCard?.documentsVerified).toBe(false);
    const insurance = await uploaded(provider.body.accessToken, {
      type: 'insurance_certificate',
      vehicleId,
      expiresOn: addDays(colomboDay(), 90),
    });
    await api()
      .post(`/api/v1/admin/documents/${insurance.id}/reject`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'The policy number is not readable' })
      .expect(200);
    const rejected = (
      await api()
        .get('/api/v1/providers/me/documents')
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body.data.find((d: ProviderDocument) => d.id === insurance.id) as ProviderDocument;
    expect(rejected).toMatchObject({
      status: 'rejected',
      effectiveStatus: 'rejected',
      reviewReason: 'The policy number is not readable',
    });
    await api()
      .post(`/api/v1/admin/documents/${insurance.id}/approve`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(409);
    // A replacement supersedes the rejected one; approving it completes the set.
    const insurance2 = await uploaded(provider.body.accessToken, {
      type: 'insurance_certificate',
      vehicleId,
      expiresOn: addDays(colomboDay(), 90),
    });
    const history = (
      await api()
        .get('/api/v1/providers/me/documents')
        .query({ vehicleId, includeHistory: 'true' })
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body.data as ProviderDocument[];
    expect(history.find((d) => d.id === insurance.id)?.effectiveStatus).toBe('superseded');
    const current = (
      await api()
        .get('/api/v1/providers/me/documents')
        .query({ vehicleId })
        .set(auth(provider.body.accessToken))
        .expect(200)
    ).body.data as ProviderDocument[];
    expect(current.map((d) => d.id)).not.toContain(insurance.id);
    await approve(insurance2.id, {});
    vehicleCard = (await searchCards()).find((c) => c.id === vehicleId);
    expect(vehicleCard?.documentsVerified).toBe(true);
    expect(vehicleCard?.provider.documentsVerified).toBe(false);
    const identity = (
      await api()
        .get('/api/v1/admin/documents')
        .query({ scope: 'provider', providerId: provider.providerId })
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body.data[0] as AdminDocument;
    await approve(identity.id, {});
    vehicleCard = (await searchCards()).find((c) => c.id === vehicleId);
    expect(vehicleCard?.provider.documentsVerified).toBe(true);
    const detail = await api().get(`/api/v1/vehicles/${vehicleSlug}`).expect(200);
    expect(detail.body.documentsVerified).toBe(true);
    expect(detail.body.provider.documentsVerified).toBe(true);
    // Replacement request keeps the document valid and tells the provider.
    await takeAllEmails(app);
    const replaced = await api()
      .post(`/api/v1/admin/documents/${identity.id}/request-replacement`)
      .set(auth(admin.body.accessToken))
      .send({ reason: 'Please upload the back side as well' })
      .expect(200);
    expect(replaced.body).toMatchObject({
      status: 'approved',
      replacementRequestedAt: expect.any(String),
      reviewReason: 'Please upload the back side as well',
    });
    expect(
      (await takeAllEmails(app)).some(
        (m) => m.to === provider.email && m.subject.toLowerCase().includes('new'),
      ),
    ).toBe(true);
    expect((await auditActions(identity.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining(['document.approved', 'document.replacement_requested']),
    );
    // Admin vehicle view carries the verification panel.
    const adminVehicle = await api()
      .get(`/api/v1/admin/vehicles/${vehicleId}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(adminVehicle.body.operations.documents).toMatchObject({
      verified: true,
      missing: [],
      expired: [],
    });
  });

  it('sends one expiry reminder per threshold, auto-pauses on expiry and gates reactivation on a renewed document', async () => {
    const today = colomboDay();
    const current = (
      await api()
        .get('/api/v1/admin/documents')
        .query({ vehicleId, status: 'approved' })
        .set(auth(admin.body.accessToken))
        .expect(200)
    ).body.data as AdminDocument[];
    const licence = current.find((d) => d.type === 'revenue_licence') as AdminDocument;
    // Bring the licence within the 14-day threshold (operator corrects the expiry date on a new upload).
    const licence2 = await uploaded(provider.body.accessToken, {
      type: 'revenue_licence',
      vehicleId,
    });
    await approve(licence2.id, { expiresOn: addDays(today, 10) });
    await takeAllEmails(app);
    const first = await expiry.sweep(new Date());
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    const reminder = await handle.db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, `document:${licence2.id}:expiry:14`));
    expect(reminder).toHaveLength(1);
    expect(reminder[0]?.type).toBe('document.expiring');
    expect(
      (await takeAllEmails(app)).filter(
        (m) => m.to === provider.email && m.subject.includes('expires'),
      ).length,
    ).toBe(1);
    const second = await expiry.sweep(new Date());
    expect(
      await handle.db
        .select()
        .from(notifications)
        .where(eq(notifications.dedupeKey, `document:${licence2.id}:expiry:14`)),
    ).toHaveLength(1);
    expect((await takeAllEmails(app)).filter((m) => m.to === provider.email).length).toBe(0);
    expect(second.autoPaused).toBe(0);
    expect(licence.id).not.toBe(licence2.id);

    // Expiry day: reminder 0, listing auto-paused (setting on by default), provider told, listing leaves search.
    const insurance = current.find((d) => d.type === 'insurance_certificate') as AdminDocument;
    const insurance2 = await uploaded(provider.body.accessToken, {
      type: 'insurance_certificate',
      vehicleId,
    });
    await approve(insurance2.id, { expiresOn: today });
    expect(insurance.id).not.toBe(insurance2.id);
    const third = await expiry.sweep(new Date());
    expect(third.expired).toBe(1);
    expect(third.autoPaused).toBe(1);
    const [vehicle] = await handle.db
      .select({ status: vehicles.status, reason: vehicles.suspensionReason })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    expect(vehicle?.status).toBe('suspended');
    expect(vehicle?.reason).toContain('Insurance certificate expired');
    const paused = await handle.db
      .select({ action: auditEvents.action, actorType: auditEvents.actorType })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetType, 'vehicle'),
          eq(auditEvents.targetId, vehicleId),
          eq(auditEvents.action, 'vehicle.auto_paused'),
        ),
      );
    expect(paused).toEqual([{ action: 'vehicle.auto_paused', actorType: 'system' }]);
    expect((await searchCards()).some((c) => c.id === vehicleId)).toBe(false);
    const expiredMail = (await takeAllEmails(app)).find(
      (m) => m.to === provider.email && m.subject.includes('expired'),
    );
    expect(expiredMail?.text).toContain('paused');
    const adminVehicle = await api()
      .get(`/api/v1/admin/vehicles/${vehicleId}`)
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(adminVehicle.body.operations).toMatchObject({
      publiclySearchable: false,
      autoPausedAt: expect.any(String),
    });
    expect(adminVehicle.body.operations.documents.expired).toContain('insurance_certificate');
    // Idempotent: a second sweep neither re-pauses nor re-notifies.
    const fourth = await expiry.sweep(new Date());
    expect(fourth).toEqual({ reminders: 0, expired: 0, autoPaused: 0 });
    // Reactivation is refused while the insurance is expired, allowed once a renewed one is approved.
    const refused = await api()
      .post(`/api/v1/admin/vehicles/${vehicleId}/reactivate`)
      .set(auth(admin.body.accessToken))
      .send({})
      .expect(409);
    expect(refused.body.error.message).toContain('insurance_certificate');
    const renewed = await uploaded(provider.body.accessToken, {
      type: 'insurance_certificate',
      vehicleId,
    });
    await approve(renewed.id, { expiresOn: addDays(today, 365) });
    await api()
      .post(`/api/v1/admin/vehicles/${vehicleId}/reactivate`)
      .set(auth(admin.body.accessToken))
      .send({ note: 'Renewed insurance approved' })
      .expect(200);
    expect((await searchCards()).find((c) => c.id === vehicleId)?.documentsVerified).toBe(true);
    // Expiring-within filter lists the short licence; superseded history is listed only on request.
    const expiring = await api()
      .get('/api/v1/admin/documents')
      .query({ expiringWithinDays: 14 })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(expiring.body.data.map((d: AdminDocument) => d.id)).toContain(licence2.id);
    const superseded = await api()
      .get('/api/v1/admin/documents')
      .query({ status: 'superseded', vehicleId })
      .set(auth(admin.body.accessToken))
      .expect(200);
    expect(superseded.body.data.map((d: AdminDocument) => d.id)).toContain(insurance2.id);
    const [stored] = await handle.db
      .select({ status: verificationDocuments.status })
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, insurance2.id));
    expect(stored?.status).toBe('approved'); // "expired" is derived, never written
  });

  it('keeps the document routes closed to customers and the private bucket out of public JSON', async () => {
    const customer = await newVerifiedUser(app, nextEmail());
    await api()
      .get('/api/v1/providers/me/documents')
      .set(auth(customer.body.accessToken))
      .expect(403);
    await api().get('/api/v1/admin/documents').set(auth(customer.body.accessToken)).expect(403);
    await api().get('/api/v1/admin/documents').set(auth(provider.body.accessToken)).expect(403);
    const search = JSON.stringify(
      (await api().get('/api/v1/vehicles/search').query({ placeId: refs.mirissaId }).expect(200))
        .body,
    );
    for (const key of storage.keys('private')) expect(search).not.toContain(key);
    expect(search).not.toMatch(/storageKey|sha256|verification_documents/);
  });
});
