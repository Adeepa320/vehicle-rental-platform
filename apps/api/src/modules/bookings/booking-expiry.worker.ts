import type { JobsService } from '../../jobs/jobs.service';
import { BOOKINGS_EXPIRE_CRON, QUEUES } from '../../jobs/queues';
import type { BookingExpiryService } from './booking-expiry.service';

/**
 * Worker-side registration of the booking expiry sweep: a pg-boss schedule
 * enqueues one `bookings.expire` job per minute; the handler expires whatever
 * is due. Idempotent, so overlapping or retried runs are harmless.
 */
export async function registerBookingJobs(
  jobs: JobsService,
  expiry: BookingExpiryService,
): Promise<void> {
  await jobs.work<Record<string, never>>(QUEUES.bookingsExpire, { batchSize: 1 }, async () => {
    await expiry.expireDue(new Date());
  });
  await jobs.schedule(QUEUES.bookingsExpire, BOOKINGS_EXPIRE_CRON);
}
