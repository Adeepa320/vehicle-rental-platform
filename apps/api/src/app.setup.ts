import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_GLOBAL_PREFIX, API_VERSION } from '@vrp/contracts';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { REQUEST_ID_HEADER } from './common/logging/logger.module';
import type { Env } from './config/env.schema';

/**
 * Applies the HTTP baseline shared by `main.ts` and the e2e tests so both run
 * the exact same middleware, prefix, versioning and body limits.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
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
  app.enableShutdownHooks();
}
