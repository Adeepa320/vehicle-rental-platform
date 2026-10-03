import { z } from 'zod';

import { PhoneE164Schema } from '../auth/user';
import { SlugIdSchema } from '../reference/reference';

/** Version stamped on an application when the provider agreement is accepted. */
export const CURRENT_PROVIDER_AGREEMENT_VERSION = '2026-10' as const;

export const ProviderTypeSchema = z.enum(['individual', 'registered_business']);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

/**
 * Application lifecycle. `approved` and `rejected` are terminal for the
 * application; suspension lives on the provider profile (`ProviderStatus`).
 */
export const ProviderApplicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
]);
export type ProviderApplicationStatus = z.infer<typeof ProviderApplicationStatusSchema>;

export const ProviderStatusSchema = z.enum(['active', 'suspended']);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/** http(s) URLs only; `javascript:` and friends are rejected. */
export const HttpUrlSchema = z.url({ protocol: /^https?$/, hostname: z.regexes.domain }).max(255);

const DisplayNameSchema = z.string().trim().min(2).max(80);
const ContactNameSchema = z.string().trim().min(2).max(100);
const AddressTextSchema = z.string().trim().min(5).max(300);
const DescriptionSchema = z.string().trim().min(20).max(1000);
const NotesSchema = z.string().trim().max(1000);
const AdminNotesSchema = z.string().trim().max(2000);
const ReasonSchema = z.string().trim().min(5).max(1000);

/**
 * `PUT /providers/me/application`. Every field is optional so applicants can
 * save progress; completeness is enforced at submission with
 * `ProviderApplicationRequiredSchema`. Unknown keys (status, review fields,
 * roles) are rejected.
 */
export const ProviderApplicationDraftSchema = z.strictObject({
  displayName: DisplayNameSchema.optional(),
  providerType: ProviderTypeSchema.optional(),
  contactName: ContactNameSchema.optional(),
  phone: PhoneE164Schema.optional(),
  whatsapp: PhoneE164Schema.nullable().optional(),
  addressText: AddressTextSchema.optional(),
  districtId: SlugIdSchema.optional(),
  primaryPlaceId: z.uuid().optional(),
  serviceAreaPlaceIds: z.array(z.uuid()).max(10).optional(),
  description: DescriptionSchema.optional(),
  yearsOperating: z.number().int().min(0).max(100).nullable().optional(),
  vehicleCategoryIds: z.array(SlugIdSchema).max(10).optional(),
  fleetSizeEstimate: z.number().int().min(1).max(500).nullable().optional(),
  offersDelivery: z.boolean().optional(),
  offersAirportTransfer: z.boolean().optional(),
  websiteUrl: HttpUrlSchema.nullable().optional(),
  applicantNotes: NotesSchema.nullable().optional(),
});
export type ProviderApplicationDraft = z.infer<typeof ProviderApplicationDraftSchema>;

/** Fields that must be present and valid before an application can be submitted. */
export const ProviderApplicationRequiredSchema = z.object({
  displayName: DisplayNameSchema,
  providerType: ProviderTypeSchema,
  contactName: ContactNameSchema,
  phone: PhoneE164Schema,
  addressText: AddressTextSchema,
  districtId: SlugIdSchema,
  primaryPlaceId: z.uuid(),
  description: DescriptionSchema,
  vehicleCategoryIds: z.array(SlugIdSchema).min(1, 'choose at least one vehicle category').max(10),
});

export const SubmitProviderApplicationRequestSchema = z.strictObject({
  acceptProviderAgreement: z.literal(true, {
    error: 'you must accept the provider agreement',
  }),
});
export type SubmitProviderApplicationRequest = z.infer<
  typeof SubmitProviderApplicationRequestSchema
>;

/** Applicant-facing view of their application. */
export const ProviderApplicationSchema = z.object({
  id: z.uuid(),
  status: ProviderApplicationStatusSchema,
  displayName: z.string().nullable(),
  providerType: ProviderTypeSchema.nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  addressText: z.string().nullable(),
  districtId: z.string().nullable(),
  primaryPlaceId: z.uuid().nullable(),
  serviceAreaPlaceIds: z.array(z.uuid()),
  description: z.string().nullable(),
  yearsOperating: z.number().int().nullable(),
  vehicleCategoryIds: z.array(z.string()),
  fleetSizeEstimate: z.number().int().nullable(),
  offersDelivery: z.boolean(),
  offersAirportTransfer: z.boolean(),
  websiteUrl: z.string().nullable(),
  applicantNotes: z.string().nullable(),
  agreementAcceptedAt: z.iso.datetime().nullable(),
  agreementVersion: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  reviewStartedAt: z.iso.datetime().nullable(),
  changesRequestedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  /** Reason given by the reviewer for `changes_requested` or `rejected`. */
  reviewReason: z.string().nullable(),
  /** Convenience flags derived from the status for the UI. */
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProviderApplication = z.infer<typeof ProviderApplicationSchema>;

export const ApplicantSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  emailVerified: z.boolean(),
  memberSince: z.iso.datetime(),
});

/** Admin view: applicant identity, internal notes and reviewer. */
export const AdminProviderApplicationSchema = ProviderApplicationSchema.extend({
  adminNotes: z.string().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  applicant: ApplicantSummarySchema,
});
export type AdminProviderApplication = z.infer<typeof AdminProviderApplicationSchema>;

export const AdminProviderApplicationSummarySchema = z.object({
  id: z.uuid(),
  status: ProviderApplicationStatusSchema,
  displayName: z.string().nullable(),
  providerType: ProviderTypeSchema.nullable(),
  districtId: z.string().nullable(),
  applicant: z.object({ id: z.uuid(), email: z.email(), fullName: z.string() }),
  submittedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type AdminProviderApplicationSummary = z.infer<typeof AdminProviderApplicationSummarySchema>;

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

export const AdminProviderApplicationListQuerySchema = PaginationQuerySchema.extend({
  status: ProviderApplicationStatusSchema.optional(),
});
export type AdminProviderApplicationListQuery = z.infer<
  typeof AdminProviderApplicationListQuerySchema
>;

export const AdminProviderApplicationListSchema = z.object({
  data: z.array(AdminProviderApplicationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminProviderApplicationList = z.infer<typeof AdminProviderApplicationListSchema>;

/** Body for request-changes and reject: the reason is shown to the applicant. */
export const ReviewReasonRequestSchema = z.strictObject({
  reason: ReasonSchema,
  adminNotes: AdminNotesSchema.optional(),
});
export type ReviewReasonRequest = z.infer<typeof ReviewReasonRequestSchema>;

export const StartReviewRequestSchema = z
  .strictObject({ adminNotes: AdminNotesSchema.optional() })
  .default({});
export const ApproveApplicationRequestSchema = z
  .strictObject({ adminNotes: AdminNotesSchema.optional() })
  .default({});
export type ApproveApplicationRequest = z.infer<typeof ApproveApplicationRequestSchema>;

export const SuspendProviderRequestSchema = z.strictObject({ reason: ReasonSchema });
export type SuspendProviderRequest = z.infer<typeof SuspendProviderRequestSchema>;
export const ReactivateProviderRequestSchema = z
  .strictObject({ note: NotesSchema.optional() })
  .default({});
export type ReactivateProviderRequest = z.infer<typeof ReactivateProviderRequestSchema>;

/** Provider's own profile (and the admin's view of it). */
export const ProviderProfileSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  providerType: ProviderTypeSchema,
  contactName: z.string(),
  phone: z.string(),
  /** Always `false` until a real phone-verification mechanism exists. */
  phoneVerified: z.boolean(),
  whatsapp: z.string().nullable(),
  description: z.string().nullable(),
  addressText: z.string(),
  districtId: z.string(),
  primaryPlaceId: z.uuid(),
  serviceAreaPlaceIds: z.array(z.uuid()),
  vehicleCategoryIds: z.array(z.string()),
  yearsOperating: z.number().int().nullable(),
  fleetSizeEstimate: z.number().int().nullable(),
  offersDelivery: z.boolean(),
  offersAirportTransfer: z.boolean(),
  websiteUrl: z.string().nullable(),
  status: ProviderStatusSchema,
  approvedAt: z.iso.datetime(),
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

/** `PATCH /providers/me`: contact and description fields only. */
export const UpdateProviderProfileRequestSchema = z.strictObject({
  contactName: ContactNameSchema.optional(),
  phone: PhoneE164Schema.optional(),
  whatsapp: PhoneE164Schema.nullable().optional(),
  description: DescriptionSchema.nullable().optional(),
  addressText: AddressTextSchema.optional(),
  websiteUrl: HttpUrlSchema.nullable().optional(),
  offersDelivery: z.boolean().optional(),
  offersAirportTransfer: z.boolean().optional(),
});
export type UpdateProviderProfileRequest = z.infer<typeof UpdateProviderProfileRequestSchema>;

export const AdminProviderSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  providerType: ProviderTypeSchema,
  status: ProviderStatusSchema,
  districtId: z.string(),
  approvedAt: z.iso.datetime(),
  suspendedAt: z.iso.datetime().nullable(),
  owner: z.object({ id: z.uuid(), email: z.email(), fullName: z.string() }),
});
export type AdminProviderSummary = z.infer<typeof AdminProviderSummarySchema>;

export const AdminProviderListQuerySchema = PaginationQuerySchema.extend({
  status: ProviderStatusSchema.optional(),
});
export type AdminProviderListQuery = z.infer<typeof AdminProviderListQuerySchema>;

export const AdminProviderListSchema = z.object({
  data: z.array(AdminProviderSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminProviderList = z.infer<typeof AdminProviderListSchema>;

export const AdminProviderDetailSchema = ProviderProfileSchema.extend({
  owner: z.object({ id: z.uuid(), email: z.email(), fullName: z.string() }),
  applicationId: z.uuid(),
  approvedBy: z.uuid().nullable(),
});
export type AdminProviderDetail = z.infer<typeof AdminProviderDetailSchema>;
