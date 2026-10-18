import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  auditEvents,
  oneTimeTokens,
  refreshTokens,
  runMigrations,
  searchLogs,
  verificationDocuments,
  type DatabaseHandle,
} from '@vrp/database';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { RetentionService } from '../src/modules/retention/retention.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import {
  newAdmin,
  newVerifiedUser,
  seedReference,
  type ApplicantSession,
} from './utils/provider-helpers';
import { approvedProvider, type ProviderSession } from './utils/vehicle-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping retention e2e tests');

const SCOPE = 'rtn';
const nextEmail = emailFactory(SCOPE);
const DAY = 86_400_000;

type TokenInsert = typeof oneTimeTokens.$inferInsert;
type SessionInsert = typeof refreshTokens.$inferInsert;
type DocumentInsert = typeof verificationDocuments.$inferInsert;

describe.skipIf(!url)('retention sweep (Phase 10): bounded, idempotent, dry-run first', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let retention: RetentionService;
  let storage: StorageService;
  let customer: ApplicantSession;
  let provider: ProviderSession;
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const tokenIds: Record<string, string> = {};
  const sessionIds: Record<string, string> = {};
  const documentIds: Record<string, string> = {};
  const documentKeys: Record<string, string> = {};
  const searchLogIds: Record<string, string> = {};

  const ids = (map: Record<string, string>, ...names: string[]) =>
    names.map((n) => map[n] as string).sort();
  const leftTokens = async () =>
    (
      await handle.db
        .select({ id: oneTimeTokens.id })
        .from(oneTimeTokens)
        .where(inArray(oneTimeTokens.id, Object.values(tokenIds)))
    )
      .map((r) => r.id)
      .sort();
  const leftSessions = async () =>
    (
      await handle.db
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(inArray(refreshTokens.id, Object.values(sessionIds)))
    )
      .map((r) => r.id)
      .sort();
  const leftDocuments = async () =>
    (
      await handle.db
        .select({ id: verificationDocuments.id })
        .from(verificationDocuments)
        .where(inArray(verificationDocuments.id, Object.values(documentIds)))
    )
      .map((r) => r.id)
      .sort();
  const leftLogs = async () =>
    (
      await handle.db
        .select({ id: searchLogs.id })
        .from(searchLogs)
        .where(inArray(searchLogs.id, Object.values(searchLogIds)))
    )
      .map((r) => r.id)
      .sort();

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    retention = app.get(RetentionService);
    storage = app.get(StorageService);
    const refs = await seedReference(app);
    const admin = await newAdmin(app, nextEmail());
    provider = await approvedProvider(app, nextEmail(), refs, admin, 'Retention Rentals');
    customer = await newVerifiedUser(app, nextEmail());

    const tokenRows: Array<[string, Partial<TokenInsert>]> = [
      ['expired-old', { purpose: 'verify_email', expiresAt: ago(9), createdAt: ago(10) }],
      [
        'consumed-old',
        { purpose: 'password_reset', expiresAt: ago(-5), consumedAt: ago(10), createdAt: ago(10) },
      ],
      ['expired-recent', { purpose: 'verify_email', expiresAt: ago(1), createdAt: ago(2) }],
      ['fresh', { purpose: 'verify_email', expiresAt: ago(-1), createdAt: now }],
    ];
    for (const [name, extra] of tokenRows) {
      const [row] = await handle.db
        .insert(oneTimeTokens)
        .values({
          userId: customer.userId,
          tokenHash: `${SCOPE}-${name}-${randomUUID()}`,
          ...extra,
        } as TokenInsert)
        .returning({ id: oneTimeTokens.id });
      tokenIds[name] = (row as { id: string }).id;
    }

    const sessionRows: Array<[string, Partial<SessionInsert>]> = [
      ['revoked-old', { expiresAt: ago(40), revokedAt: ago(41), createdAt: ago(70) }],
      ['expired-old', { expiresAt: ago(40), createdAt: ago(70) }],
      ['expired-recent', { expiresAt: ago(10), createdAt: ago(40) }],
      ['active', { expiresAt: ago(-30), createdAt: now }],
    ];
    for (const [name, extra] of sessionRows) {
      const [row] = await handle.db
        .insert(refreshTokens)
        .values({
          userId: customer.userId,
          tokenHash: `${SCOPE}-${name}-${randomUUID()}`,
          familyId: randomUUID(),
          client: 'web',
          ...extra,
        } as SessionInsert)
        .returning({ id: refreshTokens.id });
      sessionIds[name] = (row as { id: string }).id;
    }

    const documentRows: Array<[string, Partial<DocumentInsert>]> = [
      ['rejected-old', { status: 'rejected', reviewedAt: ago(40) }],
      ['rejected-recent', { status: 'rejected', reviewedAt: ago(5) }],
      ['superseded-old', { status: 'approved', supersededAt: ago(100) }],
      ['superseded-recent', { status: 'approved', supersededAt: ago(10) }],
      ['current', { status: 'approved' }],
    ];
    for (const [name, extra] of documentRows) {
      const key = `documents/${provider.providerId}/${SCOPE}-${name}-${randomUUID()}.pdf`;
      await storage.put({
        bucket: 'private',
        key,
        body: Buffer.from('%PDF-1.4 retention fixture'),
        contentType: 'application/pdf',
      });
      const [row] = await handle.db
        .insert(verificationDocuments)
        .values({
          providerId: provider.providerId,
          scope: 'provider',
          type: 'identity_document',
          storageKey: key,
          mimeType: 'application/pdf',
          sizeBytes: 26,
          sha256: 'a'.repeat(64),
          uploadedBy: provider.userId,
          ...extra,
        } as DocumentInsert)
        .returning({ id: verificationDocuments.id });
      documentIds[name] = (row as { id: string }).id;
      documentKeys[name] = key;
    }

    for (const [name, createdAt, resultCount] of [
      ['old', ago(500), 0],
      ['recent', ago(10), 2],
    ] as Array<[string, Date, number]>) {
      const [row] = await handle.db
        .insert(searchLogs)
        .values({ resultCount, filters: { scope: SCOPE, age: name }, createdAt })
        .returning({ id: searchLogs.id });
      searchLogIds[name] = (row as { id: string }).id;
    }
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('previews without deleting anything and reads the retention settings', async () => {
    const preview = await retention.sweep(now, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.settings).toEqual({
      documentRetentionRejectedDays: 30,
      documentRetentionSupersededDays: 90,
      driverSnapshotRetentionDays: 0,
      searchLogRetentionDays: 400,
    });
    expect(preview.oneTimeTokens).toBeGreaterThanOrEqual(2);
    expect(preview.refreshTokens).toBeGreaterThanOrEqual(2);
    expect(preview.documentsRejected).toBeGreaterThanOrEqual(1);
    expect(preview.documentsSuperseded).toBeGreaterThanOrEqual(1);
    expect(preview.searchLogs).toBeGreaterThanOrEqual(1);
    expect(preview.driverSnapshots).toBe(0);
    expect(await leftTokens()).toHaveLength(4);
    expect(await leftSessions()).toHaveLength(4);
    expect(await leftDocuments()).toHaveLength(5);
    expect(await leftLogs()).toHaveLength(2);
    expect(await storage.get('private', documentKeys['rejected-old'] as string)).not.toBeNull();
  });

  it('deletes exactly the expired classes, object before row, and audits the run', async () => {
    const summary = await retention.sweep(now);
    expect(summary.dryRun).toBe(false);
    expect(summary.truncated).toEqual([]);
    expect(summary.documentsSkipped).toBe(0);

    expect(await leftTokens()).toEqual(ids(tokenIds, 'expired-recent', 'fresh'));
    expect(await leftSessions()).toEqual(ids(sessionIds, 'expired-recent', 'active'));
    expect(await leftDocuments()).toEqual(
      ids(documentIds, 'rejected-recent', 'superseded-recent', 'current'),
    );
    expect(await leftLogs()).toEqual(ids(searchLogIds, 'recent'));
    expect(await storage.get('private', documentKeys['rejected-old'] as string)).toBeNull();
    expect(await storage.get('private', documentKeys['superseded-old'] as string)).toBeNull();
    expect(await storage.get('private', documentKeys['current'] as string)).not.toBeNull();
    expect(await storage.get('private', documentKeys['rejected-recent'] as string)).not.toBeNull();

    const audits = await handle.db
      .select({ metadata: auditEvents.metadata, actorType: auditEvents.actorType })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'retention.sweep_completed'),
          gt(auditEvents.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const latest = audits.at(-1);
    expect(latest?.actorType).toBe('system');
    expect(JSON.stringify(latest?.metadata)).toContain('"dryRun":false');
    expect(JSON.stringify(latest?.metadata)).not.toMatch(/@example\.com|documents\//);
  });

  it('is idempotent: a second run leaves the kept rows alone', async () => {
    await retention.sweep(now);
    expect(await leftTokens()).toHaveLength(2);
    expect(await leftSessions()).toHaveLength(2);
    expect(await leftDocuments()).toHaveLength(3);
    expect(await leftLogs()).toHaveLength(1);
  });
});
