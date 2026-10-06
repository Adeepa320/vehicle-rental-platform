import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_GLOBAL_PREFIX, API_VERSION } from '@vrp/contracts';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { REQUEST_ID_HEADER } from './common/logging/logger.module';
import type { Env } from './config/env.schema';
import { setupOpenApi } from './openapi/openapi';

/**
 * Applies the HTTP baseline shared by `main.ts` and the e2e tests so both run
 * the exact same middleware, prefix, versioning and body limits.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  // Only the refresh-token cookie is read; it is HttpOnly and path-scoped (auth-cookies.ts).
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
  // JSON bodies are small by design; files go directly to object storage (Phase 3+).
  app.useBodyParser('json', { limit: '256kb' });
  // PayHere posts its payment notification as a classic form (Phase 7).
  app.useBodyParser('urlencoded', { extended: false, limit: '64kb' });
  app.enableShutdownHooks();

  const openApiEnabled =
    config.get('OPENAPI_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'production';
  if (openApiEnabled) {
    setupOpenApi(app);
  }
}
