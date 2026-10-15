import { z } from 'zod';

import { EmailSchema, UserRoleSchema, UserStatusSchema } from '../auth/user';
import { PaginationQuerySchema } from '../providers/provider';

/**
 * Admin user management (Phase 9, PRD FR-AD2). Explicit allow-lists: never
 * password hashes, tokens, session rows or anything from the auth tables.
 */
export const AdminUserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  roles: z.array(UserRoleSchema),
  status: UserStatusSchema,
  emailVerified: z.boolean(),
  countryCode: z.string().nullable(),
  providerId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;

export const AdminUserListQuerySchema = PaginationQuerySchema.extend({
  /** Matches the e-mail or the full name (case-insensitive, partial). */
  q: z.string().trim().min(2).max(100).optional(),
  status: UserStatusSchema.optional(),
  role: UserRoleSchema.optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserListSchema = z.object({
  data: z.array(AdminUserSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminUserList = z.infer<typeof AdminUserListSchema>;

/** Why an account cannot be anonymised right now (server-derived, safe categories). */
export const AnonymisationBlockerSchema = z.enum([
  'open_booking_as_customer',
  'open_booking_as_provider',
  'open_dispute',
  'unresolved_payment',
  'refund_due',
  'privileged_account',
  'already_anonymised',
]);
export type AnonymisationBlocker = z.infer<typeof AnonymisationBlockerSchema>;

export const AdminUserDetailSchema = AdminUserSummarySchema.extend({
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  preferredLanguage: z.string(),
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  provider: z
    .object({ id: z.uuid(), displayName: z.string(), status: z.enum(['active', 'suspended']) })
    .nullable(),
  bookings: z.object({
    asCustomer: z.object({
      total: z.number().int().min(0),
      open: z.number().int().min(0),
      completed: z.number().int().min(0),
    }),
    asProvider: z.object({
      total: z.number().int().min(0),
      open: z.number().int().min(0),
      completed: z.number().int().min(0),
    }),
  }),
  reviews: z.number().int().min(0),
  openDisputes: z.number().int().min(0),
  /** What suspension / anonymisation would affect right now. */
  anonymisation: z.object({
    allowed: z.boolean(),
    blockers: z.array(AnonymisationBlockerSchema),
  }),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const SuspendUserRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
export type SuspendUserRequest = z.infer<typeof SuspendUserRequestSchema>;

export const ReactivateUserRequestSchema = z.strictObject({
  note: z.string().trim().max(500).optional(),
});
export type ReactivateUserRequest = z.infer<typeof ReactivateUserRequestSchema>;

/** Irreversible: the operator must retype the account's e-mail address. */
export const AnonymiseUserRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
  confirmEmail: EmailSchema,
});
export type AnonymiseUserRequest = z.infer<typeof AnonymiseUserRequestSchema>;

/** Neutral values written over the profile on anonymisation (DATABASE_DESIGN §9). */
export const ANONYMISED_FULL_NAME = 'Deleted user';
export const ANONYMISED_EMAIL_DOMAIN = 'anonymised.invalid';
export const ANONYMISED_REVIEWER_NAME = 'Former customer';

export function anonymisedEmailFor(userId: string): string {
  return `deleted+${userId}@${ANONYMISED_EMAIL_DOMAIN}`;
}
