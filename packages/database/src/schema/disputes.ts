import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { bookings } from './bookings';
import { users } from './users';

const tz = { withTimezone: true } as const;

export const disputeStatus = pgEnum('dispute_status', [
  'open',
  'in_review',
  'resolved',
  'rejected',
]);

/**
 * Lean disputes (Phase 9, TECH_DECISIONS D62): an overlay on a booking, never
 * a booking state. One dispute per booking (unique); the header is updated by
 * the admin decision, the thread below is append-only. Reason and resolution
 * codes are validated by the contracts. Nothing here references payments: a
 * refund recommendation is executed through the Phase 7 admin payment tools.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    openedByUserId: uuid('opened_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** `customer` | `provider` */
    openedByRole: text('opened_by_role').notNull(),
    reasonCode: text('reason_code').notNull(),
    description: text('description').notNull(),
    status: disputeStatus('status').notNull().default('open'),
    assignedAdminId: uuid('assigned_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolutionCode: text('resolution_code'),
    /** Shown to both participants once decided. */
    publicResolutionNote: text('public_resolution_note'),
    /** Admin-only. */
    internalAdminNote: text('internal_admin_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', tz),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('disputes_booking_id_key').on(t.bookingId),
    index('disputes_status_created_idx').on(t.status, t.createdAt),
    index('disputes_assigned_admin_idx').on(t.assignedAdminId, t.createdAt),
  ],
);

export type DisputeRow = typeof disputes.$inferSelect;
export type NewDisputeRow = typeof disputes.$inferInsert;

/** Append-only thread; an UPDATE trigger refuses every change (custom migration). */
export const disputeMessages = pgTable(
  'dispute_messages',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputes.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** `customer` | `provider` | `admin` */
    authorRole: text('author_role').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [index('dispute_messages_dispute_idx').on(t.disputeId, t.createdAt)],
);

export type DisputeMessageRow = typeof disputeMessages.$inferSelect;
export type NewDisputeMessageRow = typeof disputeMessages.$inferInsert;
