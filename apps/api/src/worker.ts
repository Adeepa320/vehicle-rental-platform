import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { JobsService } from './jobs/jobs.service';
import { EmailService } from './modules/notifications/email/email.service';
import { registerEmailJobs } from './modules/notifications/email/email.worker';
import { WorkerModule } from './worker.module';

/**
 * Background worker entrypoint. Same codebase and configuration as the API,
 * run as a separate process so queue work never competes with HTTP traffic.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    // Reject instead of process.abort() so the catch below can log a readable message.
    abortOnError: false,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const jobs = app.get(JobsService);
  await jobs.start('worker');
  await registerEmailJobs(jobs, app.get(EmailService));
  logger.log(`Worker ready; registered job handlers: ${jobs.registeredJobNames.join(', ')}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Worker failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
