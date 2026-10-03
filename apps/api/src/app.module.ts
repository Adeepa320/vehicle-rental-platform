import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';

// Config first: it loads `.env` at import time and later imports read process.env.
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLoggerModule } from './common/logging/logger.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './modules/admin/admin.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { EmailModule } from './modules/notifications/email/email.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { StorageModule } from './modules/storage/storage.module';
import { SystemModule } from './modules/system/system.module';
import { UsersModule } from './modules/users/users.module';

/**
 * HTTP application root. Cross-cutting infrastructure (config, logging, rate
 * limiting, database, jobs, audit, error handling, authentication) lives here;
 * business modules are added under `modules/` and import only what they need.
 *
 * Global guard order: rate limit → authentication (routes are protected
 * unless `@Public()`) → roles.
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
    JobsModule,
    AuditModule,
    EmailModule,
    StorageModule,
    SystemModule,
    ReferenceModule,
    UsersModule,
    AuthModule,
    ProvidersModule,
    CatalogueModule,
    AvailabilityModule,
    DiscoveryModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
