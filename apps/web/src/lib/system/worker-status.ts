/**
 * `GET /admin/system/worker` (Phase 10): the shape lives in the shared contracts; re-exported
 * here so the admin System page keeps its import path.
 */
export {
  WorkerQueueStatusSchema,
  WorkerScheduleStatusSchema,
  WorkerStatusSchema,
  type WorkerQueueStatus,
  type WorkerStatus,
} from '@vrp/contracts';
export type { z } from 'zod';
