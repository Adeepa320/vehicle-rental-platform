import { Module } from '@nestjs/common';

import { AppLoggerModule } from './common/logging/logger.module';
import { AppConfigModule } from './config/config.module';
import { JobsModule } from './jobs/jobs.module';
import { EmailModule } from './modules/notifications/email/email.module';

/**
 * Root module for the background worker process (`node dist/worker.js`).
 * Shares config and logging with the API but exposes no HTTP server.
 */
@Module({
  imports: [AppConfigModule, AppLoggerModule, JobsModule, EmailModule],
})
export class WorkerModule {}
