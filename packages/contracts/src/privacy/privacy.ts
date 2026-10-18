import { z } from 'zod';

import { AnonymisationBlockerSchema } from '../admin/users';
import { EmailSchema } from '../auth/user';

/**
 * Data-subject requests and the personal-data export (Phase 10, PRD FR-A7,
 * TECH_DECISIONS D69). A request is a durable record worked from the admin
 * console; a deletion is completed through the existing anonymisation, an
 * access request through the same allow-listed export the user can download
 * themselves. Statutory response times are not encoded here: the operator's
 * runbook states them once legal review confirms them.
 */
export const PrivacyRequestTypeSchema = z.enum(['access', 'deletion']);
export type PrivacyRequestType = z.infer<typeof PrivacyRequestTypeSchema>;

export const PrivacyRequestStatusSchema = z.enum(['open', 'in_review', 'completed', 'rejected']);
export type PrivacyRequestStatus = z.infer<typeof PrivacyRequestStatusSchema>;

export const PRIVACY_REQUEST_OPEN_STATUSES: readonly PrivacyRequestStatus[] = ['open', 'in_review'];

/** The account holder asks for deletion; typing the e-mail is the confirmation step. */
export const CreateDeletionRequestSchema = z.strictObject({
  confirmEmail: EmailSchema,
  note: z.string().trim().max(1000).optional(),
});
export type CreateDeletionRequest = z.infer<typeof CreateDeletionRequestSchema>;

/** What the requester sees about their own request. */
export const PrivacyRequestSchema = z.object({
  id: z.uuid(),
  type: PrivacyRequestTypeSchema,
  status: PrivacyRequestStatusSchema,
  requestedAt: z.iso.datetime(),
  acknowledgedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  /** Written by the operator when completing or rejecting. */
  publicNote: z.string().nullable(),
  /** For an open deletion request: what currently prevents anonymisation (informational). */
  blockers: z.array(AnonymisationBlockerSchema),
});
export type PrivacyRequest = z.infer<typeof PrivacyRequestSchema>;

export const PrivacyRequestListSchema = z.object({ data: z.array(PrivacyRequestSchema) });
export type PrivacyRequestList = z.infer<typeof PrivacyRequestListSchema>;

export const PrivacyRequestSourceSchema = z.enum(['self', 'admin']);

export const AdminPrivacyRequestSchema = PrivacyRequestSchema.extend({
  source: PrivacyRequestSourceSchema,
  requesterNote: z.string().nullable(),
  internalNote: z.string().nullable(),
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    fullName: z.string(),
    status: z.enum(['active', 'suspended', 'deleted']),
    roles: z.array(z.string()),
  }),
  handledBy: z.object({ id: z.uuid(), email: z.string() }).nullable(),
  updatedAt: z.iso.datetime(),
});
export type AdminPrivacyRequest = z.infer<typeof AdminPrivacyRequestSchema>;

export const AdminPrivacyRequestListQuerySchema = z.object({
  status: PrivacyRequestStatusSchema.optional(),
  type: PrivacyRequestTypeSchema.optional(),
  userId: z.uuid().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminPrivacyRequestListQuery = z.infer<typeof AdminPrivacyRequestListQuerySchema>;

export const AdminPrivacyRequestListSchema = z.object({
  data: z.array(AdminPrivacyRequestSchema),
  nextCursor: z.string().nullable(),
});
export type AdminPrivacyRequestList = z.infer<typeof AdminPrivacyRequestListSchema>;

/** A request received outside the product (e-mail, phone), recorded by an operator on the user's behalf. */
export const AdminCreatePrivacyRequestSchema = z.strictObject({
  userId: z.uuid(),
  type: PrivacyRequestTypeSchema,
  requesterNote: z.string().trim().max(1000).optional(),
});
export type AdminCreatePrivacyRequest = z.infer<typeof AdminCreatePrivacyRequestSchema>;

export const AdminPrivacyRequestNoteSchema = z.strictObject({
  note: z.string().trim().max(4000),
});
export type AdminPrivacyRequestNote = z.infer<typeof AdminPrivacyRequestNoteSchema>;

export const AdminPrivacyRequestRejectSchema = z.strictObject({
  /** Shown to the requester. */
  publicNote: z.string().trim().min(10).max(2000),
  internalNote: z.string().trim().max(4000).optional(),
});
export type AdminPrivacyRequestReject = z.infer<typeof AdminPrivacyRequestRejectSchema>;

/** Completing an access request: the export was handed over outside the platform or downloaded by the user. */
export const AdminPrivacyRequestCompleteAccessSchema = z.strictObject({
  publicNote: z.string().trim().min(10).max(2000),
  internalNote: z.string().trim().max(4000).optional(),
});
export type AdminPrivacyRequestCompleteAccess = z.infer<
  typeof AdminPrivacyRequestCompleteAccessSchema
>;

/** Completing a deletion request runs the Phase 9 anonymisation with the same confirmation it always had. */
export const AdminPrivacyRequestCompleteDeletionSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
  confirmEmail: EmailSchema,
  publicNote: z.string().trim().min(10).max(2000).optional(),
  internalNote: z.string().trim().max(4000).optional(),
});
export type AdminPrivacyRequestCompleteDeletion = z.infer<
  typeof AdminPrivacyRequestCompleteDeletionSchema
>;

// ------------------------------------------------------------- data export

export const USER_DATA_EXPORT_SCHEMA_VERSION = 'vrp-user-export/1' as const;
/** Each list in the export is capped; the file says so when a cap applied. */
export const USER_DATA_EXPORT_LIST_LIMIT = 1000;

const Iso = z.iso.datetime();
const Money = z.string();

export const UserDataExportSchema = z.object({
  schemaVersion: z.literal(USER_DATA_EXPORT_SCHEMA_VERSION),
  generatedAt: Iso,
  subject: z.object({ userId: z.uuid() }),
  /** Lists that hit `USER_DATA_EXPORT_LIST_LIMIT` and were cut. */
  truncated: z.array(z.string()),
  account: z.object({
    email: z.string(),
    emailVerifiedAt: Iso.nullable(),
    fullName: z.string(),
    phone: z.string().nullable(),
    roles: z.array(z.string()),
    status: z.string(),
    countryCode: z.string().nullable(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: Iso.nullable(),
    privacyVersion: z.string().nullable(),
    createdAt: Iso,
    lastLoginAt: Iso.nullable(),
  }),
  preferences: z.object({ language: z.string(), currency: z.string() }),
  sessions: z.object({
    /** Count only — no identifiers, hashes or addresses. */
    active: z.number().int().min(0),
    mfaEnrolled: z.boolean(),
  }),
  provider: z
    .object({
      displayName: z.string(),
      legalType: z.string(),
      status: z.string(),
      contactName: z.string().nullable(),
      contactPhone: z.string().nullable(),
      whatsappNumber: z.string().nullable(),
      website: z.string().nullable(),
      description: z.string().nullable(),
      createdAt: Iso,
      locations: z.array(
        z.object({
          name: z.string(),
          addressLine: z.string().nullable(),
          placeName: z.string().nullable(),
          districtId: z.string(),
          isActive: z.boolean(),
        }),
      ),
      vehicles: z.array(
        z.object({
          title: z.string(),
          registrationNumber: z.string(),
          status: z.string(),
          dailyRate: Money,
          createdAt: Iso,
        }),
      ),
      documents: z.array(
        z.object({
          scope: z.string(),
          type: z.string(),
          status: z.string(),
          documentNumber: z.string().nullable(),
          issuedOn: z.string().nullable(),
          expiresOn: z.string().nullable(),
          uploadedAt: Iso,
        }),
      ),
    })
    .nullable(),
  bookings: z.array(
    z.object({
      reference: z.string(),
      role: z.enum(['customer', 'provider']),
      status: z.string(),
      startsAt: Iso,
      endsAt: Iso,
      vehicleTitle: z.string(),
      /** The other party's public display name only. */
      counterparty: z.string(),
      rentalSubtotal: Money,
      advanceAmount: Money,
      createdAt: Iso,
      driver: z
        .object({
          fullName: z.string(),
          licenceCountry: z.string().nullable(),
          licenceExpiresOn: z.string().nullable(),
        })
        .nullable(),
      customerNote: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      bookingReference: z.string(),
      amount: Money,
      status: z.string(),
      paidAt: Iso.nullable(),
      refundedAmount: Money.nullable(),
      refundedAt: Iso.nullable(),
    }),
  ),
  reviews: z.array(
    z.object({
      bookingReference: z.string(),
      overallRating: z.number(),
      comment: z.string().nullable(),
      status: z.string(),
      createdAt: Iso,
      providerReply: z.string().nullable(),
    }),
  ),
  disputes: z.array(
    z.object({
      bookingReference: z.string(),
      openedByMe: z.boolean(),
      reasonCode: z.string(),
      description: z.string().nullable(),
      status: z.string(),
      createdAt: Iso,
      /** Only the messages this user wrote. */
      myMessages: z.array(z.object({ body: z.string(), createdAt: Iso })),
    }),
  ),
  notifications: z.array(
    z.object({ type: z.string(), title: z.string(), body: z.string(), createdAt: Iso }),
  ),
  privacyRequests: z.array(
    z.object({
      type: PrivacyRequestTypeSchema,
      status: PrivacyRequestStatusSchema,
      requestedAt: Iso,
      completedAt: Iso.nullable(),
    }),
  ),
});
export type UserDataExport = z.infer<typeof UserDataExportSchema>;
