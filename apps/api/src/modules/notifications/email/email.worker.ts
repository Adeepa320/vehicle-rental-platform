import type { JobsService } from '../../../jobs/jobs.service';
import { QUEUES } from '../../../jobs/queues';
import type { EmailMessage } from './email-provider';
import type { EmailService } from './email.service';

/**
 * Registers the worker-side handler for the `email.send` queue. One job per
 * message; a failed delivery throws so pg-boss retries with backoff.
 */
export async function registerEmailJobs(jobs: JobsService, email: EmailService): Promise<void> {
  await jobs.work<EmailMessage>(QUEUES.emailSend, { batchSize: 5 }, async (batch) => {
    for (const job of batch) {
      await email.deliver(job.data);
    }
  });
}
