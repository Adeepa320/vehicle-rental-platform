import { z } from 'zod';

import { BookingStatusSchema } from '../bookings/booking';
import { BookingPaymentSummarySchema } from '../payments/payment';
import { PaginationQuerySchema } from '../providers/provider';
import { DisputeStatusSchema } from './status';

/**
 * Lean disputes (Phase 9, TECH_DECISIONS D62): one dispute per booking, a
 * plain append-only message thread, an admin decision with a public note.
 * Nothing here moves money: a refund recommendation is acted on separately
 * through the Phase 7 payment tooling. Attachments are deferred.
 */
export { DisputeStatusSchema, OPEN_DISPUTE_STATUSES, type DisputeStatus } from './status';

export const DisputeReasonCodeSchema = z.enum([
  'vehicle_condition',
  'vehicle_not_as_listed',
  'pickup_problem',
  'payment_or_refund',
  'damage_claim',
  'deposit_issue',
  'cancellation_issue',
  'other',
]);
export type DisputeReasonCode = z.infer<typeof DisputeReasonCodeSchema>;

export const DisputeResolutionCodeSchema = z.enum([
  'no_action',
  'provider_warning',
  'customer_warning',
  'refund_recommended',
  'resolved_between_parties',
  'other',
]);
export type DisputeResolutionCode = z.infer<typeof DisputeResolutionCodeSchema>;

export const DisputePartySchema = z.enum(['customer', 'provider']);
export type DisputeParty = z.infer<typeof DisputePartySchema>;

export const DisputeAuthorRoleSchema = z.enum(['customer', 'provider', 'admin']);
export type DisputeAuthorRole = z.infer<typeof DisputeAuthorRoleSchema>;

/** Booking statuses from which a participant may open a dispute (PRD FR-T4). */
export const DISPUTABLE_BOOKING_STATUSES = [
  'active',
  'completed',
  'no_show',
  'cancelled_by_customer',
  'cancelled_by_provider',
  'cancelled_by_platform',
] as const;

export const DISPUTE_DESCRIPTION_MAX = 2000;
export const DISPUTE_MESSAGE_MAX = 2000;

export const OpenDisputeRequestSchema = z.strictObject({
  reasonCode: DisputeReasonCodeSchema,
  description: z.string().trim().min(20).max(DISPUTE_DESCRIPTION_MAX),
});
export type OpenDisputeRequest = z.infer<typeof OpenDisputeRequestSchema>;

export const DisputeMessageRequestSchema = z.strictObject({
  body: z.string().trim().min(1).max(DISPUTE_MESSAGE_MAX),
});
export type DisputeMessageRequest = z.infer<typeof DisputeMessageRequestSchema>;

/** One thread entry. Participants and admins see the same shape; the author is a role plus a display name. */
export const DisputeMessageSchema = z.object({
  id: z.uuid(),
  authorRole: DisputeAuthorRoleSchema,
  /** "You", the counterparty's first name / display name, or "Platform team". */
  authorName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type DisputeMessage = z.infer<typeof DisputeMessageSchema>;

/** What a participant sees: never the internal admin note, never the other party's contact details. */
export const DisputeSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  bookingReference: z.string(),
  bookingStatus: BookingStatusSchema,
  vehicleTitle: z.string(),
  openedBy: DisputePartySchema,
  /** Whether the caller opened it. */
  openedByMe: z.boolean(),
  reasonCode: DisputeReasonCodeSchema,
  description: z.string(),
  status: DisputeStatusSchema,
  resolutionCode: DisputeResolutionCodeSchema.nullable(),
  publicResolutionNote: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  messages: z.array(DisputeMessageSchema),
  /** Participants may post while the dispute is open or in review. */
  canMessage: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Dispute = z.infer<typeof DisputeSchema>;

/** `GET /bookings/{id}/dispute`: eligibility plus the dispute when one exists. */
export const BookingDisputeStateSchema = z.object({
  eligible: z.boolean(),
  reason: z
    .enum(['not_disputable_status', 'window_closed', 'already_exists', 'not_participant'])
    .nullable(),
  windowClosesAt: z.iso.datetime().nullable(),
  dispute: DisputeSchema.nullable(),
});
export type BookingDisputeState = z.infer<typeof BookingDisputeStateSchema>;

export const AdminDisputeSummarySchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  bookingReference: z.string(),
  bookingStatus: BookingStatusSchema,
  vehicleTitle: z.string(),
  providerDisplayName: z.string(),
  customerName: z.string(),
  openedBy: DisputePartySchema,
  reasonCode: DisputeReasonCodeSchema,
  status: DisputeStatusSchema,
  assignedAdminId: z.uuid().nullable(),
  messageCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminDisputeSummary = z.infer<typeof AdminDisputeSummarySchema>;

export const AdminDisputeListQuerySchema = PaginationQuerySchema.extend({
  status: DisputeStatusSchema.optional(),
  bookingId: z.uuid().optional(),
});
export type AdminDisputeListQuery = z.infer<typeof AdminDisputeListQuerySchema>;

export const AdminDisputeListSchema = z.object({
  data: z.array(AdminDisputeSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminDisputeList = z.infer<typeof AdminDisputeListSchema>;

/** Admin detail: the full thread, the internal note, both parties and the payment summary. */
export const AdminDisputeSchema = DisputeSchema.omit({ openedByMe: true, canMessage: true }).extend(
  {
    customer: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
    provider: z.object({ id: z.uuid(), displayName: z.string(), ownerEmail: z.string() }),
    openedByUserId: z.uuid().nullable(),
    assignedAdminId: z.uuid().nullable(),
    internalAdminNote: z.string().nullable(),
    resolvedBy: z.uuid().nullable(),
    payment: BookingPaymentSummarySchema,
    bookingStartsAt: z.iso.datetime(),
    bookingEndsAt: z.iso.datetime(),
  },
);
export type AdminDispute = z.infer<typeof AdminDisputeSchema>;

export const StartDisputeReviewRequestSchema = z.strictObject({
  note: z.string().trim().max(500).optional(),
});
export type StartDisputeReviewRequest = z.infer<typeof StartDisputeReviewRequestSchema>;

export const DisputeInternalNoteRequestSchema = z.strictObject({
  note: z.string().trim().min(1).max(2000),
});
export type DisputeInternalNoteRequest = z.infer<typeof DisputeInternalNoteRequestSchema>;

export const ResolveDisputeRequestSchema = z.strictObject({
  resolutionCode: DisputeResolutionCodeSchema,
  publicNote: z.string().trim().min(5).max(2000),
  internalNote: z.string().trim().max(2000).optional(),
});
export type ResolveDisputeRequest = z.infer<typeof ResolveDisputeRequestSchema>;

export const RejectDisputeRequestSchema = z.strictObject({
  publicNote: z.string().trim().min(5).max(2000),
  internalNote: z.string().trim().max(2000).optional(),
});
export type RejectDisputeRequest = z.infer<typeof RejectDisputeRequestSchema>;

export const DISPUTE_REASON_LABEL: Record<DisputeReasonCode, string> = {
  vehicle_condition: 'Vehicle condition',
  vehicle_not_as_listed: 'Vehicle not as listed',
  pickup_problem: 'Pickup problem',
  payment_or_refund: 'Payment or refund',
  damage_claim: 'Damage claim',
  deposit_issue: 'Deposit issue',
  cancellation_issue: 'Cancellation issue',
  other: 'Other',
};

export const DISPUTE_RESOLUTION_LABEL: Record<DisputeResolutionCode, string> = {
  no_action: 'No action',
  provider_warning: 'Provider warned',
  customer_warning: 'Customer warned',
  refund_recommended: 'Refund recommended',
  resolved_between_parties: 'Resolved between the parties',
  other: 'Other',
};
