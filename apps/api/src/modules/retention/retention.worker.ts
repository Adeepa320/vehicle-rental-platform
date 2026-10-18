import type { JobsService } from '../../jobs/jobs.service';
import { QUEUES, RETENTION_SWEEP_CRON } from '../../jobs/queues';
import type { RetentionService } from './retention.service';

/**
 * Worker-side registration of the daily retention sweep (Phase 10). One job
 * per day; the handler deletes in bounded batches and is idempotent, so a
 * retried or doubled run only finds less to do.
 */
export async function registerRetentionJobs(
  jobs: JobsService,
  retention: RetentionService,
): Promise<void> {
  await jobs.work<Record<string, never>>(QUEUES.retentionSweep, { batchSize: 1 }, async () => {
    await retention.sweep(new Date());
  });
  await jobs.schedule(QUEUES.retentionSweep, RETENTION_SWEEP_CRON);
}
