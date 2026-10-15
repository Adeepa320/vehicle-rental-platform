import type { JobsService } from '../../jobs/jobs.service';
import { DOCUMENTS_EXPIRY_SWEEP_CRON, QUEUES } from '../../jobs/queues';
import type { DocumentExpiryService } from './document-expiry.service';

/**
 * Worker-side registration of the daily document expiry sweep (Phase 9): a
 * pg-boss schedule enqueues one `documents.expiry-sweep` job per day; the
 * handler sends the due reminders and applies the optional auto-pause. Each
 * reminder is deduplicated at the database, so a retried run is harmless.
 */
export async function registerDocumentJobs(
  jobs: JobsService,
  expiry: DocumentExpiryService,
): Promise<void> {
  await jobs.work<Record<string, never>>(
    QUEUES.documentsExpirySweep,
    { batchSize: 1 },
    async () => {
      await expiry.sweep(new Date());
    },
  );
  await jobs.schedule(QUEUES.documentsExpirySweep, DOCUMENTS_EXPIRY_SWEEP_CRON);
}
