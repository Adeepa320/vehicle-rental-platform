import { z } from 'zod';

/**
 * Worker / job-queue status for operators (Phase 10). Read from the pg-boss
 * tables by the API, exposed only to administrators (never on the public
 * health probes). The minute `reminders.sweep` schedule doubles as the
 * worker heartbeat: when its last completion is older than
 * `staleAfterSeconds` the worker is considered down.
 */
export const WorkerQueueStatusSchema = z.object({
  name: z.string(),
  lastCompletedAt: z.iso.datetime().nullable(),
  completedLast24h: z.number().int().min(0),
  failedLast24h: z.number().int().min(0),
  active: z.number().int().min(0),
  queued: z.number().int().min(0),
});
export type WorkerQueueStatus = z.infer<typeof WorkerQueueStatusSchema>;

export const WorkerScheduleStatusSchema = z.object({
  name: z.string(),
  cron: z.string(),
  updatedAt: z.iso.datetime().nullable(),
});

export const WorkerStatusSchema = z.object({
  healthy: z.boolean(),
  checkedAt: z.iso.datetime(),
  heartbeatQueue: z.string(),
  staleAfterSeconds: z.number().int().positive(),
  heartbeatLastCompletedAt: z.iso.datetime().nullable(),
  schedules: z.array(WorkerScheduleStatusSchema),
  queues: z.array(WorkerQueueStatusSchema),
});
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;
