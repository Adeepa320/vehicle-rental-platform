import {
  index,
  inet,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { users } from './users';

export const oneTimeTokenPurpose = pgEnum('one_time_token_purpose', [
  'verify_email',
  'password_reset',
]);

/**
 * Single-use, expiring tokens delivered by e-mail as links (email
 * verification, password reset). Only the SHA-256 hash is stored; the raw
 * token exists solely in the e-mail. Consuming sets `consumed_at`; requesting
 * a new token for the same purpose consumes the previous ones. Rows are kept
 * briefly for rate limiting and then purged (SECURITY_AND_PRIVACY.md §8).
 *
 * When SMS OTP codes arrive (later phase) this table gains a `channel`
 * column; the design's `otp_codes` table is this table under its final name.
 */
export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: oneTimeTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestIp: inet('request_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('one_time_tokens_token_hash_key').on(t.tokenHash),
    index('one_time_tokens_user_purpose_idx').on(t.userId, t.purpose, t.createdAt),
  ],
);

export type OneTimeToken = typeof oneTimeTokens.$inferSelect;
export type NewOneTimeToken = typeof oneTimeTokens.$inferInsert;
export type OneTimeTokenPurpose = (typeof oneTimeTokenPurpose.enumValues)[number];
