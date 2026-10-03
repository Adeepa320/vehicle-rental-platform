import type { NestExpressApplication } from '@nestjs/platform-express';
import { oneTimeTokens, runMigrations, users, type DatabaseHandle } from '@vrp/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import {
  cleanupUsers,
  emailFactory,
  extractToken,
  registerUser,
  takeEmailFor,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping e-mail verification e2e tests');

const SCOPE = 'verify';
const nextEmail = emailFactory(SCOPE);

describe.skipIf(!url)('e-mail verification', () => {
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

  it('blocks login until the e-mail is verified, then allows it', async () => {
    const email = nextEmail();
    await registerUser(app, email);

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const token = extractToken(await takeEmailFor(app, email, 'Verify'));
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token })
      .expect(200);
    expect(verified.body).toEqual({ verified: true, email });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse battery staple' })
      .expect(200);
    expect(login.body.user.emailVerified).toBe(true);
  });

  it('stores only a hash of the token and refuses reuse', async () => {
    const email = nextEmail();
    const { user } = await registerUser(app, email);
    const token = extractToken(await takeEmailFor(app, email, 'Verify'));

    const rows = await handle.db
      .select()
      .from(oneTimeTokens)
      .where(eq(oneTimeTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.tokenHash).not.toBe(token);

    await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token })
      .expect(200);
    const reused = await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token })
      .expect(400);
    expect(reused.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects expired tokens and leaves the account unverified', async () => {
    const email = nextEmail();
    const { user } = await registerUser(app, email);
    const token = extractToken(await takeEmailFor(app, email, 'Verify'));
    await handle.db
      .update(oneTimeTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(oneTimeTokens.userId, user.id));

    const expired = await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token })
      .expect(400);
    expect(expired.body.error.code).toBe('TOKEN_EXPIRED');

    const [row] = await handle.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.emailVerifiedAt).toBeNull();
  });

  it('rejects malformed and unknown tokens', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token: 'short' })
      .expect(400);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token: 'A'.repeat(43) })
      .expect(400);
    expect(unknown.body.error.code).toBe('TOKEN_INVALID');
  });

  it('resend issues a fresh token, supersedes the old one, caps per account and never reveals existence', async () => {
    const email = nextEmail();
    const { user } = await registerUser(app, email);
    const first = extractToken(await takeEmailFor(app, email, 'Verify'));

    const resend = await request(app.getHttpServer())
      .post('/api/v1/auth/email/resend-verification')
      .send({ email })
      .expect(202);
    const second = extractToken(await takeEmailFor(app, email, 'Verify'));
    expect(second).not.toBe(first);

    // The superseded token no longer works; the new one does.
    const stale = await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token: first })
      .expect(400);
    expect(stale.body.error.code).toBe('TOKEN_INVALID');

    // Cap: 3 tokens per 15 minutes per account (register + 2 resends). The third
    // resend request is silently dropped: 202, but no token and no e-mail.
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/resend-verification')
      .send({ email })
      .expect(202);
    const third = extractToken(await takeEmailFor(app, email, 'Verify'));
    expect(third).not.toBe(second);

    await request(app.getHttpServer())
      .post('/api/v1/auth/email/resend-verification')
      .send({ email })
      .expect(202);
    expect(await takeEmailFor(app, email, 'Verify')).toBeUndefined();
    const issued = await handle.db
      .select()
      .from(oneTimeTokens)
      .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.purpose, 'verify_email')));
    expect(issued).toHaveLength(3);

    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/email/resend-verification')
      .send({ email: nextEmail() })
      .expect(202);
    expect(unknown.body).toEqual(resend.body);

    // Only the newest token is live.
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token: second })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/verify')
      .send({ token: third })
      .expect(200);
  });
});
