import { sql } from 'drizzle-orm';
import {
  char,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns, citext } from './_types';

export const userRole = pgEnum('user_role', ['customer', 'provider', 'admin', 'super_admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);

/**
 * One row per person. A user may hold several roles (`roles` array); public
 * registration always yields `{customer}` and privileged roles are granted
 * only by a super admin (Phase 9).
 *
 * Phase 2 scope: email + password accounts. `email` and `password_hash` are
 * NOT NULL for now; they become nullable when phone-first registration and
 * OAuth arrive (DATABASE_DESIGN.md §6.1). `phone_e164` is an optional,
 * unverified contact field until SMS verification exists.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    email: citext('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneE164: text('phone_e164'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    /** Argon2id PHC string. Never logged, never returned. */
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    roles: userRole('roles')
      .array()
      .notNull()
      .default(sql`'{customer}'::user_role[]`),
    status: userStatus('status').notNull().default('active'),
    preferredLanguage: text('preferred_language').notNull().default('en'),
    preferredCurrency: char('preferred_currency', { length: 3 }).notNull().default('LKR'),
    countryCode: char('country_code', { length: 2 }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: text('terms_version'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /**
     * Access tokens issued before this instant are rejected by the auth guard.
     * Set on password reset, logout-all and suspension so stateless JWTs can
     * still be invalidated immediately.
     */
    sessionsRevokedAt: timestamp('sessions_revoked_at', { withTimezone: true }),
    ...auditColumns,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key')
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
    index('users_roles_idx').using('gin', t.roles),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = (typeof userRole.enumValues)[number];
export type UserStatus = (typeof userStatus.enumValues)[number];
