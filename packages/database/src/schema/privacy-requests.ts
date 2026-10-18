import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { users } from './users';

const tz = { withTimezone: true } as const;

export const privacyRequestType = pgEnum('privacy_request_type', ['access', 'deletion']);
export const privacyRequestStatus = pgEnum('privacy_request_status', [
  'open',
  'in_review',
  'completed',
  'rejected',
]);

/**
 * Data-subject requests (Phase 10, TECH_DECISIONS D69): a durable record of
 * who asked for what and when, worked from the admin console. The exported
 * data is never stored here; a deletion request is completed through the
 * existing admin anonymisation (`AdminUsersService.anonymise`), never by a
 * second erasure path. One request of each type may be open per user.
 */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: privacyRequestType('type').notNull(),
    status: privacyRequestStatus('status').notNull().default('open'),
    /** `self` (the account holder through the API) or `admin` (recorded on their behalf from e-mail / support). */
    source: text('source').notNull(),
    /** Free text the requester added (≤ 1000 chars); shown to admins only. */
    requesterNote: text('requester_note'),
    requestedAt: timestamp('requested_at', tz).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', tz),
    completedAt: timestamp('completed_at', tz),
    rejectedAt: timestamp('rejected_at', tz),
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    /** Shown to the requester when the request is completed or rejected. */
    publicNote: text('public_note'),
    /** Never leaves the admin console. */
    internalNote: text('internal_note'),
    ...auditColumns,
  },
  (t) => [
    index('privacy_requests_status_idx').on(t.status, t.requestedAt),
    index('privacy_requests_user_idx').on(t.userId, t.requestedAt),
    uniqueIndex('privacy_requests_open_key')
      .on(t.userId, t.type)
      .where(sql`${t.status} in ('open', 'in_review')`),
  ],
);

export type PrivacyRequestRow = typeof privacyRequests.$inferSelect;
export type PrivacyRequestType = (typeof privacyRequestType.enumValues)[number];
export type PrivacyRequestStatus = (typeof privacyRequestStatus.enumValues)[number];
