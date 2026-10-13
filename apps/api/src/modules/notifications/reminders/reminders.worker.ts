import type { JobsService } from '../../../jobs/jobs.service';
import { QUEUES, REMINDERS_SWEEP_CRON } from '../../../jobs/queues';
import type { RemindersService } from './reminders.service';

/**
 * Worker-side registration of the reminder sweep: a pg-boss schedule enqueues
 * one `reminders.sweep` job per minute; the handler sends whatever is due.
 * Idempotent (dedupe keys), so overlapping or retried runs are harmless.
 */
export async function registerReminderJobs(
  jobs: JobsService,
  reminders: RemindersService,
): Promise<void> {
  await jobs.work<Record<string, never>>(QUEUES.remindersSweep, { batchSize: 1 }, async () => {
    await reminders.sendDue(new Date());
  });
  await jobs.schedule(QUEUES.remindersSweep, REMINDERS_SWEEP_CRON);
}
