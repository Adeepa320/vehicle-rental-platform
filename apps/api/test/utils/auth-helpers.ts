import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthSessionResponse, RegisterResponse } from '@vrp/contracts';
import { users, type DatabaseHandle } from '@vrp/database';
import { like } from 'drizzle-orm';
import request, { type Response } from 'supertest';

import { DATABASE_HANDLE } from '../../src/database/database.module';
import { JobsService } from '../../src/jobs/jobs.service';
import { QUEUES } from '../../src/jobs/queues';
import type { EmailMessage } from '../../src/modules/notifications/email/email-provider';

export const REFRESH_COOKIE_NAME = 'vrp_refresh';
export const TEST_PASSWORD = 'correct horse battery staple';

/** Unique e-mail prefix per test file so parallel/sequential runs never collide. */
export function emailFactory(scope: string): () => string {
  const run = Math.random().toString(36).slice(2, 8);
  let n = 0;
  return () => `e2e+${scope}-${run}-${(n += 1)}@example.com`;
}

export function registerPayload(email: string, overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Nimal Perera',
    email,
    password: TEST_PASSWORD,
    acceptTerms: true,
    ...overrides,
  };
}

export async function registerUser(
  app: NestExpressApplication,
  email: string,
  overrides: Record<string, unknown> = {},
): Promise<RegisterResponse> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send(registerPayload(email, overrides))
    .expect(201);
  return response.body as RegisterResponse;
}

/**
 * Drains every queued e-mail job (completing it) and returns the messages in
 * queue order. Use this when one action produces mail for several recipients.
 */
export async function takeAllEmails(app: INestApplicationContext): Promise<EmailMessage[]> {
  const jobs = app.get(JobsService);
  const messages: EmailMessage[] = [];
  // The queue is FIFO and may hold leftovers from earlier suites; keep fetching until empty.
  for (let round = 0; round < 50; round += 1) {
    const batch = await jobs.fetch<EmailMessage>(QUEUES.emailSend, 100);
    if (batch.length === 0) break;
    await jobs.queue.complete(
      QUEUES.emailSend,
      batch.map((job) => job.id),
    );
    messages.push(...batch.map((job) => job.data));
    if (batch.length < 100) break;
  }
  return messages;
}

/** Latest message in `messages` addressed to `to` (optionally with `subjectContains`). */
export function findEmail(
  messages: EmailMessage[],
  to: string,
  subjectContains?: string,
): EmailMessage | undefined {
  return messages
    .filter((m) => m.to.toLowerCase() === to.toLowerCase())
    .filter((m) => (subjectContains ? m.subject.includes(subjectContains) : true))
    .at(-1);
}

/**
 * Drains queued e-mail jobs and returns the latest message addressed to
 * `to`. Jobs are completed so later calls only see new messages — including
 * mail to other recipients, so prefer `takeAllEmails` when several were sent.
 */
export async function takeEmailFor(
  app: INestApplicationContext,
  to: string,
  subjectContains?: string,
): Promise<EmailMessage | undefined> {
  return findEmail(await takeAllEmails(app), to, subjectContains);
}

export function extractToken(message: EmailMessage | undefined): string {
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No token link found in e-mail to ${message?.to ?? 'unknown'}`);
  return match[1];
}

export async function registerAndVerify(
  app: NestExpressApplication,
  email: string,
): Promise<RegisterResponse> {
  const registered = await registerUser(app, email);
  const token = extractToken(await takeEmailFor(app, email, 'Verify'));
  await request(app.getHttpServer()).post('/api/v1/auth/email/verify').send({ token }).expect(200);
  return registered;
}

export interface LoginResult {
  body: AuthSessionResponse;
  /** Raw `Set-Cookie` header value for the refresh cookie. */
  cookie: string;
  /** `vrp_refresh=<value>` pair for the `Cookie` request header. */
  cookieHeader: string;
}

export function refreshCookieFrom(response: Response): { cookie: string; cookieHeader: string } {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!cookie) throw new Error('Refresh cookie not set');
  return { cookie, cookieHeader: cookie.split(';')[0] as string };
}

export async function login(
  app: NestExpressApplication,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<LoginResult> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email, password })
    .expect(200);
  return { body: response.body as AuthSessionResponse, ...refreshCookieFrom(response) };
}

/** Removes every e2e user created with the given scope prefix (cascades to tokens). */
export async function cleanupUsers(app: INestApplicationContext, scope: string): Promise<void> {
  const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
  await handle.db.delete(users).where(like(users.email, `e2e+${scope}-%`));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for the wall clock to move to the next whole second (sessions_revoked_at is compared at second precision). */
export async function nextSecond(): Promise<void> {
  const now = Date.now();
  await sleep(1000 - (now % 1000) + 50);
}
