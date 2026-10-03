/**
 * Every pg-boss queue the platform uses, with its creation options. Queues
 * must exist before jobs are sent; `JobsService.start()` creates missing ones.
 */
export const QUEUES = {
  /** Transactional e-mail delivery (verification, password reset, ...). Payload: `EmailMessage`. */
  emailSend: 'email.send',
  /** Scheduled sweep that expires overdue booking requests / acceptances (Phase 6). Payload: `{}`. */
  bookingsExpire: 'bookings.expire',
} as const;

/** Cron (UTC) for the booking expiry sweep: every minute; the job itself is idempotent. */
export const BOOKINGS_EXPIRE_CRON = '* * * * *';

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface QueueDefinition {
  name: QueueName;
  options: {
    retryLimit: number;
    /** Seconds before the first retry; doubles each attempt when `retryBackoff` is true. */
    retryDelay: number;
    retryBackoff: boolean;
    /** Seconds a single attempt may run before it is failed and retried. */
    expireInSeconds: number;
    /** Days completed/failed jobs stay in the table for inspection. */
    retentionDays: number;
  };
}

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: QUEUES.emailSend,
    options: {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 60,
      retentionDays: 7,
    },
  },
  {
    name: QUEUES.bookingsExpire,
    options: {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: false,
      expireInSeconds: 120,
      retentionDays: 2,
    },
  },
];
