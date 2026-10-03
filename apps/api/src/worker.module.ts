import { Module } from '@nestjs/common';

import { AppLoggerModule } from './common/logging/logger.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { BookingsCoreModule } from './modules/bookings/bookings-core.module';
import { EmailModule } from './modules/notifications/email/email.module';

/**
 * Root module for the background worker process (`node dist/worker.js`).
 * Shares config and logging with the API but exposes no HTTP server. The
 * database is needed for the booking expiry sweep (Phase 6).
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    JobsModule,
    EmailModule,
    BookingsCoreModule,
  ],
})
export class WorkerModule {}
