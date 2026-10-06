import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

/**
 * Values every e2e test starts from; individual files override what they need.
 * Set `TEST_LOG_LEVEL=error` (or `info`) to see API logs while debugging a test.
 */
export const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
  CORS_ORIGINS: 'http://localhost:3000',
  WEB_APP_URL: 'http://localhost:3000',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '1000',
  AUTH_LOGIN_LIMIT_PER_MINUTE: '1000',
  AUTH_SENSITIVE_LIMIT_PER_15MIN: '1000',
  AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN: '3',
  // Faster Argon2 for tests only; production defaults stay at 64 MiB / 3 iterations.
  ARGON2_MEMORY_KIB: '16384',
  ARGON2_TIME_COST: '2',
  EMAIL_PROVIDER: 'memory',
  PGBOSS_SCHEMA: 'pgboss_test',
  // Photos go to an in-memory store; the MinIO path is covered by the smoke test and an opt-in integration test.
  STORAGE_PROVIDER: 'memory',
  STORAGE_PUBLIC_URL: 'http://storage.test/vrp-public',
  OPENAPI_ENABLED: 'true',
  // Deterministic payment gateway: PayHere adapter with a known fake secret (see payment-helpers.ts).
  PAYMENT_GATEWAY: 'fake',
  PAYHERE_MERCHANT_SECRET: 'e2e-fake-merchant-secret-32-characters!',
  API_PUBLIC_URL: 'http://api.test/api/v1',
};

/** Connection URL of the dedicated test database, if configured. */
export function testDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL_TEST;
}

export interface CreateTestAppOptions {
  env?: Record<string, string>;
  /** Extra controllers registered on the root testing module (e.g. role-guard fixtures). */
  controllers?: Type[];
}

/**
 * Builds a fully configured application for supertest.
 *
 * Environment variables are applied BEFORE `AppModule` is imported because
 * `ConfigModule.forRoot` validates the environment at import time. Vitest
 * isolates module registries per test file, so each file gets one environment:
 * put scenarios that need different env values in separate files.
 */
export async function createTestApp(
  envOrOptions: Record<string, string> | CreateTestAppOptions = {},
): Promise<NestExpressApplication> {
  const options: CreateTestAppOptions =
    'env' in envOrOptions || 'controllers' in envOrOptions
      ? (envOrOptions as CreateTestAppOptions)
      : { env: envOrOptions as Record<string, string> };

  Object.assign(process.env, TEST_ENV_DEFAULTS, {
    // The pool connects lazily, so tests that never touch the database can use a dummy URL.
    DATABASE_URL: testDatabaseUrl() ?? 'postgresql://postgres:postgres@127.0.0.1:1/unused',
    ...options.env,
  });

  // `.js` extensions are required by NodeNext resolution; Vitest maps them to the `.ts` sources.
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
