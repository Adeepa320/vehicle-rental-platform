import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { users } from './users';

const tz = { withTimezone: true } as const;

/**
 * In-app notification feed (DATABASE_DESIGN §6.10, lean Phase 8). Titles and
 * bodies are platform-written plain text (never HTML, never user-controlled
 * markup); `link_path` is an application-relative path validated at creation;
 * `metadata` holds safe ids only (booking / review ids), never payment
 * identifiers, gateway payloads or contact data. `dedupe_key` makes every
 * lifecycle event and reminder idempotent: a retried job or a replayed
 * transaction cannot create a second row (TECH_DECISIONS D58).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Dotted event type, e.g. `booking.accepted`, `payment.reminder`, `review.received`. */
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    linkPath: text('link_path'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', tz),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_key_key')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
