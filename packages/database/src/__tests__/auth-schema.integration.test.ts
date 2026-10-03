import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseHandle } from '../client';
import { runMigrations } from '../migrate';
import { oneTimeTokens, refreshTokens, users } from '../schema';

const url = process.env.DATABASE_URL_TEST;
if (!url) {
  console.warn('DATABASE_URL_TEST is not set: skipping auth schema integration tests');
}

const suffix = Math.random().toString(36).slice(2, 10);
const email = `Schema.Test+${suffix}@Example.com`;

describe.skipIf(!url)('auth schema (integration)', () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    await runMigrations(url as string);
    handle = createDatabase({ url: url as string, max: 2, applicationName: 'vrp-db-auth-test' });
  });

  afterAll(async () => {
    await handle.db.delete(users).where(eq(users.email, email));
    await handle.close();
  });

  it('stores users with generated UUIDv7 ids, default role and case-insensitive unique email', async () => {
    const [created] = await handle.db
      .insert(users)
      .values({ email, passwordHash: 'not-a-real-hash', fullName: 'Schema Test' })
      .returning();
    expect(created?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(created?.roles).toEqual(['customer']);
    expect(created?.status).toBe('active');
    expect(created?.emailVerifiedAt).toBeNull();

    // citext: a differently-cased duplicate violates the unique index. Drizzle wraps the
    // driver error, so the PostgreSQL code and constraint name live on `cause`.
    const duplicate = await handle.db
      .insert(users)
      .values({ email: email.toUpperCase(), passwordHash: 'x', fullName: 'Dup' })
      .then(() => undefined)
      .catch((error: unknown) => error as { cause?: { code?: string; constraint_name?: string } });
    expect(duplicate).toBeDefined();
    expect(duplicate?.cause?.code).toBe('23505');
    expect(duplicate?.cause?.constraint_name).toBe('users_email_key');

    // citext: lookups are case-insensitive too.
    const [found] = await handle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()));
    expect(found?.id).toBe(created?.id);
  });

  it('cascades token rows when a user is deleted', async () => {
    const [user] = await handle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const userId = user?.id as string;
    const expiresAt = new Date(Date.now() + 60_000);
    await handle.db.insert(refreshTokens).values({
      userId,
      tokenHash: `hash-${suffix}`,
      familyId: '0192f0a0-0000-7000-8000-000000000001',
      client: 'web',
      expiresAt,
    });
    await handle.db.insert(oneTimeTokens).values({
      userId,
      purpose: 'verify_email',
      tokenHash: `ott-${suffix}`,
      expiresAt,
    });

    await handle.db.delete(users).where(eq(users.id, userId));

    expect(
      await handle.db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)),
    ).toHaveLength(0);
    expect(
      await handle.db.select().from(oneTimeTokens).where(eq(oneTimeTokens.userId, userId)),
    ).toHaveLength(0);
  });
});
