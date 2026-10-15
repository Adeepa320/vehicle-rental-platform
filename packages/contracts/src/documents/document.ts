import { z } from 'zod';

import { PaginationQuerySchema } from '../providers/provider';

/**
 * Private verification documents (Phase 9, TECH_DECISIONS D61). Providers
 * upload identity / business documents for themselves and registration,
 * revenue-licence, insurance and emission documents for their vehicles.
 * Files live in the private bucket under server-generated keys and are never
 * exposed through public APIs; the only reads are the owner's and an admin's
 * audited streaming endpoint. Expiry is derived from `expiresOn` on approved
 * documents, never set by hand.
 */
export const DocumentScopeSchema = z.enum(['provider', 'vehicle']);
export type DocumentScope = z.infer<typeof DocumentScopeSchema>;

export const ProviderDocumentTypeSchema = z.enum([
  'identity_document',
  'business_registration',
  'other',
]);
export type ProviderDocumentType = z.infer<typeof ProviderDocumentTypeSchema>;

export const VehicleDocumentTypeSchema = z.enum([
  'certificate_of_registration',
  'revenue_licence',
  'insurance_certificate',
  'emission_certificate',
]);
export type VehicleDocumentType = z.infer<typeof VehicleDocumentTypeSchema>;

export const DocumentTypeSchema = z.enum([
  ...ProviderDocumentTypeSchema.options,
  ...VehicleDocumentTypeSchema.options,
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

/** Stored review state; `expired` and `superseded` are derived (see `DocumentEffectiveStatusSchema`). */
export const DocumentStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentEffectiveStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  /** Approved but `expiresOn` is in the past (Colombo calendar day). */
  'expired',
  /** A newer upload of the same type replaced this one; kept for history. */
  'superseded',
]);
export type DocumentEffectiveStatus = z.infer<typeof DocumentEffectiveStatusSchema>;

/** Vehicle document types whose approval is required for the "Verified vehicle" badge. */
export const REQUIRED_VEHICLE_DOCUMENT_TYPES: readonly VehicleDocumentType[] = [
  'certificate_of_registration',
  'revenue_licence',
  'insurance_certificate',
];
/** Vehicle document types that carry an expiry date (and drive the expiry sweep). */
export const EXPIRING_VEHICLE_DOCUMENT_TYPES: readonly VehicleDocumentType[] = [
  'revenue_licence',
  'insurance_certificate',
];
/** Days-before-expiry thresholds at which one reminder each is sent (0 = expiry day). */
export const DOCUMENT_EXPIRY_REMINDER_DAYS: readonly number[] = [30, 14, 7, 0];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** MIME types accepted after sniffing the bytes (never from the declared content type). */
export const ACCEPTED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AcceptedDocumentMimeType = (typeof ACCEPTED_DOCUMENT_MIME_TYPES)[number];

const IsoDate = z.iso.date();

/** Multipart fields accompanying the file on upload (`POST /providers/me/documents`). */
export const UploadDocumentFieldsSchema = z
  .strictObject({
    type: DocumentTypeSchema,
    /** Required for vehicle document types; must be one of the caller's vehicles. */
    vehicleId: z.uuid().optional(),
    /** Policy / certificate number as printed; optional, never shown publicly. */
    documentNumber: z.string().trim().min(1).max(60).optional(),
    issuedOn: IsoDate.optional(),
    expiresOn: IsoDate.optional(),
  })
  .superRefine((v, ctx) => {
    const isVehicleType = (VehicleDocumentTypeSchema.options as readonly string[]).includes(v.type);
    if (isVehicleType && !v.vehicleId) {
      ctx.addIssue({
        code: 'custom',
        path: ['vehicleId'],
        message: 'vehicle documents must name the vehicle',
      });
    }
    if (!isVehicleType && v.vehicleId) {
      ctx.addIssue({
        code: 'custom',
        path: ['vehicleId'],
        message: 'provider documents do not belong to a vehicle',
      });
    }
    if (v.issuedOn && v.expiresOn && v.expiresOn <= v.issuedOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresOn'],
        message: 'expiry must be after the issue date',
      });
    }
  });
export type UploadDocumentFields = z.infer<typeof UploadDocumentFieldsSchema>;

/** The owner's view: no storage keys, no internal notes. */
export const ProviderDocumentSchema = z.object({
  id: z.uuid(),
  scope: DocumentScopeSchema,
  type: DocumentTypeSchema,
  vehicleId: z.uuid().nullable(),
  status: DocumentStatusSchema,
  effectiveStatus: DocumentEffectiveStatusSchema,
  mimeType: z.enum(ACCEPTED_DOCUMENT_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  documentNumber: z.string().nullable(),
  issuedOn: IsoDate.nullable(),
  expiresOn: IsoDate.nullable(),
  /** Shown to the provider after a rejection or a replacement request. */
  reviewReason: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  replacementRequestedAt: z.iso.datetime().nullable(),
  supersededAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProviderDocument = z.infer<typeof ProviderDocumentSchema>;

export const ProviderDocumentListSchema = z.object({ data: z.array(ProviderDocumentSchema) });
export type ProviderDocumentList = z.infer<typeof ProviderDocumentListSchema>;

export const ProviderDocumentListQuerySchema = z.object({
  vehicleId: z.uuid().optional(),
  /** Include superseded uploads (history); default current only. */
  includeHistory: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ProviderDocumentListQuery = z.infer<typeof ProviderDocumentListQuerySchema>;

/** Admin view adds the owner, the reviewer and the vehicle label. */
export const AdminDocumentSchema = ProviderDocumentSchema.extend({
  provider: z.object({ id: z.uuid(), displayName: z.string(), status: z.string() }),
  vehicle: z.object({ id: z.uuid(), title: z.string(), status: z.string() }).nullable(),
  uploadedBy: z.uuid().nullable(),
  reviewedBy: z.uuid().nullable(),
  /** Days until expiry (negative once expired); null without an expiry date. */
  daysUntilExpiry: z.number().int().nullable(),
});
export type AdminDocument = z.infer<typeof AdminDocumentSchema>;

export const AdminDocumentListQuerySchema = PaginationQuerySchema.extend({
  status: DocumentEffectiveStatusSchema.optional(),
  scope: DocumentScopeSchema.optional(),
  providerId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  /** Approved documents expiring within this many days (incl. already expired). */
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});
export type AdminDocumentListQuery = z.infer<typeof AdminDocumentListQuerySchema>;

export const AdminDocumentListSchema = z.object({
  data: z.array(AdminDocumentSchema),
  nextCursor: z.string().nullable(),
});
export type AdminDocumentList = z.infer<typeof AdminDocumentListSchema>;

export const ApproveDocumentRequestSchema = z.strictObject({
  /** Lets the reviewer record the expiry printed on the document. */
  expiresOn: IsoDate.nullable().optional(),
  note: z.string().trim().max(500).optional(),
});
export type ApproveDocumentRequest = z.infer<typeof ApproveDocumentRequestSchema>;

export const RejectDocumentRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
export type RejectDocumentRequest = z.infer<typeof RejectDocumentRequestSchema>;

export const RequestDocumentReplacementRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
export type RequestDocumentReplacementRequest = z.infer<
  typeof RequestDocumentReplacementRequestSchema
>;

/**
 * Verification summary derived from current, approved, in-date documents
 * (SECURITY_AND_PRIVACY §3.2 trust wording): "Verified vehicle" needs every
 * required type; "Verified provider" needs the identity document and, for a
 * registered business, the business registration.
 */
export const DocumentVerificationSchema = z.object({
  verified: z.boolean(),
  /** Required types that are not currently approved and in date. */
  missing: z.array(DocumentTypeSchema),
  /** Approved documents whose expiry has passed. */
  expired: z.array(DocumentTypeSchema),
  /** Uploads awaiting review. */
  pending: z.array(DocumentTypeSchema),
});
export type DocumentVerification = z.infer<typeof DocumentVerificationSchema>;

export function requiredProviderDocumentTypes(
  providerType: 'individual' | 'registered_business',
): readonly ProviderDocumentType[] {
  return providerType === 'registered_business'
    ? ['identity_document', 'business_registration']
    : ['identity_document'];
}
