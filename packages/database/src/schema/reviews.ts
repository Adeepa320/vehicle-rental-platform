import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { bookings } from './bookings';
import { providerProfiles } from './providers';
import { users } from './users';
import { vehicles } from './vehicles';

const tz = { withTimezone: true } as const;

/** `published` is the default; `hidden` is reactive admin moderation (TECH_DECISIONS D57). */
export const reviewStatus = pgEnum('review_status', ['published', 'hidden']);

/**
 * One customer review per completed booking (DATABASE_DESIGN §6.9, lean Phase 8).
 * Identity columns are derived from the booking by the server; ratings are
 * 1–5 with database checks; the provider may reply once. Hidden reviews stay
 * for moderation and audit and simply stop counting publicly. Rating
 * aggregates are computed by indexed SQL on read (TECH_DECISIONS D57).
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    customerUserId: uuid('customer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    overallRating: smallint('overall_rating').notNull(),
    vehicleRating: smallint('vehicle_rating'),
    serviceRating: smallint('service_rating'),
    communicationRating: smallint('communication_rating'),
    comment: text('comment'),
    providerReply: text('provider_reply'),
    providerRepliedAt: timestamp('provider_replied_at', tz),
    status: reviewStatus('status').notNull().default('published'),
    hiddenAt: timestamp('hidden_at', tz),
    hiddenBy: uuid('hidden_by').references(() => users.id, { onDelete: 'set null' }),
    hiddenReason: text('hidden_reason'),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('reviews_booking_id_key').on(t.bookingId),
    index('reviews_vehicle_published_idx')
      .on(t.vehicleId, t.createdAt)
      .where(sql`${t.status} = 'published'`),
    index('reviews_provider_published_idx')
      .on(t.providerId, t.createdAt)
      .where(sql`${t.status} = 'published'`),
    index('reviews_customer_idx').on(t.customerUserId),
    index('reviews_status_created_idx').on(t.status, t.createdAt),
    check('reviews_overall_rating_check', sql`${t.overallRating} between 1 and 5`),
    check(
      'reviews_sub_ratings_check',
      sql`(${t.vehicleRating} is null or ${t.vehicleRating} between 1 and 5) and (${t.serviceRating} is null or ${t.serviceRating} between 1 and 5) and (${t.communicationRating} is null or ${t.communicationRating} between 1 and 5)`,
    ),
    check(
      'reviews_hidden_state_check',
      sql`(${t.status} = 'hidden') = (${t.hiddenAt} is not null)`,
    ),
    check(
      'reviews_reply_state_check',
      sql`(${t.providerReply} is null) = (${t.providerRepliedAt} is null)`,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type NewReviewRow = typeof reviews.$inferInsert;
export type ReviewStatus = (typeof reviewStatus.enumValues)[number];
