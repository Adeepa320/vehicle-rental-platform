import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { users } from './users';

const tz = { withTimezone: true } as const;

/**
 * Authenticator-app (TOTP) second factor for privileged accounts (Phase 10,
 * TECH_DECISIONS D67). One row per user. The TOTP secret is stored only as an
 * AES-256-GCM envelope produced by the application data-encryption key, with
 * the user id as additional authenticated data; the base32 secret appears in
 * exactly one API response, during enrolment. `confirmed_at` is NULL while the
 * enrolment is pending (the user has not yet proven they captured the secret)
 * and `last_used_step` refuses a code that was already accepted.
 */
export const userMfa = pgTable('user_mfa', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** `v1.<keyId>.<nonce>.<tag>.<ciphertext>`; never the plaintext secret. */
  secretCiphertext: text('secret_ciphertext').notNull(),
  confirmedAt: timestamp('confirmed_at', tz),
  /** Highest 30-second step for which a code was accepted (replay guard). */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  /** Consecutive wrong codes; reset on success. */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  /** Set after too many wrong codes; verification is refused until then. */
  lockedUntil: timestamp('locked_until', tz),
  recoveryCodesGeneratedAt: timestamp('recovery_codes_generated_at', tz),
  ...auditColumns,
});

/**
 * One-time recovery codes: SHA-256 of the canonical code (ten base32
 * characters, ≈ 50 bits of entropy) and the moment it was consumed.
 * Regeneration deletes every row of the user and inserts a fresh set.
 */
export const userMfaRecoveryCodes = pgTable(
  'user_mfa_recovery_codes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', tz),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_mfa_recovery_codes_hash_key').on(t.codeHash),
    index('user_mfa_recovery_codes_user_idx').on(t.userId),
  ],
);

export type UserMfa = typeof userMfa.$inferSelect;
export type UserMfaRecoveryCode = typeof userMfaRecoveryCodes.$inferSelect;
