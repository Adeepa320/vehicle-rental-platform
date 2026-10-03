import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

/** Values every e2e test starts from; individual files override what they need. */
export const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:3000',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '1000',
};

/** Connection URL of the dedicated test database, if configured. */
export function testDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL_TEST;
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
  env: Record<string, string> = {},
): Promise<NestExpressApplication> {
  Object.assign(process.env, TEST_ENV_DEFAULTS, {
    // The pool connects lazily, so tests that never touch the database can use a dummy URL.
    DATABASE_URL: testDatabaseUrl() ?? 'postgresql://postgres:postgres@127.0.0.1:1/unused',
    ...env,
  });

  // `.js` extensions are required by NodeNext resolution; Vitest maps them to the `.ts` sources.
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
