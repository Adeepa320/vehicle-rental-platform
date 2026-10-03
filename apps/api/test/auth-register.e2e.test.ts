import type { NestExpressApplication } from '@nestjs/platform-express';
import { RegisterResponseSchema } from '@vrp/contracts';
import { runMigrations, users, type DatabaseHandle } from '@vrp/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import {
  cleanupUsers,
  emailFactory,
  registerPayload,
  registerUser,
  takeEmailFor,
} from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping registration e2e tests');

const SCOPE = 'reg';
const nextEmail = emailFactory(SCOPE);

describe.skipIf(!url)('POST /api/v1/auth/register', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('creates an unverified customer, hashes the password and queues a verification e-mail', async () => {
    const email = nextEmail();
    const body = await registerUser(app, email.toUpperCase(), { fullName: '  Nimal Perera ' });

    expect(RegisterResponseSchema.safeParse(body).success).toBe(true);
    expect(body.user.email).toBe(email); // normalised to lower case
    expect(body.user.fullName).toBe('Nimal Perera');
    expect(body.user.roles).toEqual(['customer']);
    expect(body.user.emailVerified).toBe(false);
    expect(body.verification.emailSent).toBe(true);
    expect(JSON.stringify(body)).not.toContain('password');

    const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    const [row] = await handle.db.select().from(users).where(eq(users.email, email));
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row?.passwordHash).not.toContain('correct horse');
    expect(row?.termsVersion).toBe('2026-10');
    expect(row?.termsAcceptedAt).toBeInstanceOf(Date);

    const message = await takeEmailFor(app, email, 'Verify');
    expect(message).toBeDefined();
    expect(message?.text).toMatch(/http:\/\/localhost:3000\/verify-email\?token=[A-Za-z0-9_-]{43}/);
  });

  it('rejects a duplicate e-mail regardless of case with 409', async () => {
    const email = nextEmail();
    await registerUser(app, email);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email.toUpperCase()))
      .expect(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects invalid input with field-level details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ fullName: 'A', email: 'not-an-email', password: 'short', acceptTerms: false })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const fields = response.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['acceptTerms', 'email', 'fullName', 'password']);
  });

  it('rejects weak passwords that pass the length rule', async () => {
    const email = nextEmail();
    const common = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, { password: 'password1234' }))
      .expect(400);
    expect(common.body.error.details[0].field).toBe('password');

    const containsEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload('sunil.jay@example.com', { password: 'sunil.jay2026!' }))
      .expect(400);
    expect(containsEmail.body.error.details[0].issue).toMatch(/email/);
  });

  it('never lets a client choose its own roles', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(nextEmail(), { roles: ['admin'] }))
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
