import type { NestExpressApplication } from '@nestjs/platform-express';
import { auditEvents, runMigrations, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GrantAdminError, grantRole } from '../src/cli/grant-admin.js';
import { DATABASE_HANDLE } from '../src/database/database.module';
import { cleanupUsers, emailFactory, registerAndVerify, registerUser } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin bootstrap tests');

const SCOPE = 'grant';
const nextEmail = emailFactory(SCOPE);

describe.skipIf(!url)('admin bootstrap (grantRole)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('grants admin to a verified account idempotently and records an audit event', async () => {
    const email = nextEmail();
    const { user } = await registerAndVerify(app, email);

    const first = await grantRole(handle.db, email.toUpperCase(), 'admin');
    expect(first).toEqual({ userId: user.id, roles: ['customer', 'admin'], changed: true });

    const second = await grantRole(handle.db, email, 'admin');
    expect(second.changed).toBe(false);
    expect(second.roles).toEqual(['customer', 'admin']);

    const events = await handle.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'user'), eq(auditEvents.targetId, user.id)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'admin.role_granted', actorType: 'system' });
    expect(events[0]?.metadata).toMatchObject({ role: 'admin', via: 'cli' });
  });

  it('refuses unknown, unverified and malformed targets', async () => {
    await expect(grantRole(handle.db, nextEmail(), 'admin')).rejects.toBeInstanceOf(
      GrantAdminError,
    );
    await expect(grantRole(handle.db, 'not-an-email', 'admin')).rejects.toThrow(/valid e-mail/);

    const unverified = nextEmail();
    await registerUser(app, unverified);
    await expect(grantRole(handle.db, unverified, 'super_admin')).rejects.toThrow(/not verified/);
  });
});
