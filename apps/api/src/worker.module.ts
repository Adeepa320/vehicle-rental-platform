import { Module } from '@nestjs/common';

import { AppLoggerModule } from './common/logging/logger.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { AuditModule } from './modules/audit/audit.module';
import { BookingsCoreModule } from './modules/bookings/bookings-core.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RetentionModule } from './modules/retention/retention.module';
import { EmailModule } from './modules/notifications/email/email.module';
import { RemindersModule } from './modules/notifications/reminders/reminders.module';
import { StorageModule } from './modules/storage/storage.module';

/**
 * Root module for the background worker process (`node dist/worker.js`).
 * Shares config and logging with the API but exposes no HTTP server. The
 * database is needed for the booking expiry sweep (Phase 6), the reminder
 * sweep (Phase 8) and the document expiry sweep (Phase 9), which also needs
 * the catalogue (auto-pause) and therefore the global audit and storage modules.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    ObservabilityModule,
    DatabaseModule,
    JobsModule,
    AuditModule,
    StorageModule,
    EmailModule,
    BookingsCoreModule,
    RemindersModule,
    DocumentsModule,
    RetentionModule,
  ],
})
export class WorkerModule {}
