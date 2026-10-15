import { z } from 'zod';

import { PaginationQuerySchema } from '../providers/provider';

/**
 * Read-only audit trail for the admin console (Phase 9). Rows are immutable
 * (`audit_events` is append-only); the API returns an allow-list projection
 * and drops any metadata key that looks like a secret.
 */
export const AuditActorTypeSchema = z.enum(['admin', 'provider', 'customer', 'system']);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

export const AuditEventViewSchema = z.object({
  id: z.uuid(),
  actorType: AuditActorTypeSchema,
  actor: z.object({ id: z.uuid(), email: z.string(), fullName: z.string() }).nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.uuid().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEventView = z.infer<typeof AuditEventViewSchema>;

export const AuditEventListQuerySchema = PaginationQuerySchema.extend({
  actorUserId: z.uuid().optional(),
  /** Exact action (`vehicle.suspended`) or a prefix with a trailing dot (`vehicle.`). */
  action: z
    .string()
    .trim()
    .regex(/^[a-z_]+(\.[a-z_]*)?$/)
    .max(80)
    .optional(),
  targetType: z
    .string()
    .trim()
    .regex(/^[a-z_]+$/)
    .max(40)
    .optional(),
  targetId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type AuditEventListQuery = z.infer<typeof AuditEventListQuerySchema>;

export const AuditEventListSchema = z.object({
  data: z.array(AuditEventViewSchema),
  nextCursor: z.string().nullable(),
});
export type AuditEventList = z.infer<typeof AuditEventListSchema>;
