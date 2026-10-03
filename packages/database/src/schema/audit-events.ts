import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { users } from './users';

/**
 * Append-only record of significant actions by admins, providers and the
 * system (implements the design's `admin_audit_logs`, generalised so provider
 * actions such as "application submitted" are captured too). Never updated or
 * deleted; the actor reference is nulled if the user is removed.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** `admin` | `provider` | `customer` | `system` */
    actorType: text('actor_type').notNull(),
    /** Dotted verb, e.g. `provider_application.approved`, `admin.role_granted`. */
    action: text('action').notNull(),
    /** e.g. `provider_application`, `provider_profile`, `user`. */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_target_idx').on(t.targetType, t.targetId, t.createdAt),
    index('audit_events_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_events_action_idx').on(t.action, t.createdAt),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
