import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLoggerModule } from './common/logging/logger.module';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { SystemModule } from './modules/system/system.module';

/**
 * HTTP application root. Cross-cutting infrastructure (config, logging, rate
 * limiting, database, error handling) lives here; business modules are added
 * under `modules/` in later phases and import only what they need.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: 'global',
            ttl: seconds(config.get('RATE_LIMIT_TTL_SECONDS', { infer: true })),
            limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          },
        ],
      }),
    }),
    DatabaseModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
