import { z } from 'zod';

import { LkrAmountSchema, SettlementCurrencySchema } from '../common/money';

/**
 * Payments (Phase 7, TECH_DECISIONS D53–D56). Only the online **advance** is
 * collected in the MVP money model (D8): the rental balance and the refundable
 * deposit are settled between customer and provider at pickup. The gateway is
 * PayHere (hosted checkout); a deterministic fake gateway serves tests and the
 * local smoke test. Card data never reaches this platform.
 */
export const PaymentGatewaySchema = z.enum(['payhere', 'fake']);
export type PaymentGatewayName = z.infer<typeof PaymentGatewaySchema>;

export const PaymentTypeSchema = z.enum(['advance']);
export type PaymentType = z.infer<typeof PaymentTypeSchema>;

/** Every state the code can reach; `refunded` is set only by an admin refund record. */
export const PaymentStatusSchema = z.enum(['pending', 'paid', 'failed', 'cancelled', 'refunded']);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/** Why a payment needs a human: set with `requiresManualResolution`. */
export const PaymentAnomalySchema = z.enum([
  'amount_mismatch',
  'currency_mismatch',
  /** Verified success after the booking expired or was cancelled: money received, booking not confirmed. */
  'late_success',
  /** Verified success for a booking already confirmed by another payment. */
  'duplicate_payment',
  'chargeback',
  /** A cancellation entitles the customer to a refund that has not been recorded yet. */
  'refund_due',
]);
export type PaymentAnomaly = z.infer<typeof PaymentAnomalySchema>;

/** What the customer's booking page shows about the advance. */
export const BookingPaymentStateSchema = z.enum([
  'not_started',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refund_due',
  /** Cancelled too close to pickup: the advance is kept under the cancellation rule. */
  'forfeited',
  'refunded',
]);
export type BookingPaymentState = z.infer<typeof BookingPaymentStateSchema>;

/** Summary embedded in every booking view (role-aware: ids only for the customer and admins). */
export const BookingPaymentSummarySchema = z.object({
  state: BookingPaymentStateSchema,
  /** The advance amount from the booking snapshot. */
  advanceAmount: LkrAmountSchema,
  currency: SettlementCurrencySchema,
  paidAt: z.iso.datetime().nullable(),
  /** Amount the platform owes back after a cancellation, until an admin records the refund. */
  refundDueAmount: LkrAmountSchema.nullable(),
  refundedAt: z.iso.datetime().nullable(),
});
export type BookingPaymentSummary = z.infer<typeof BookingPaymentSummarySchema>;

/** `POST /bookings/{id}/payments/checkout`: everything the browser needs to hand off to the gateway. */
export const CheckoutSessionSchema = z.object({
  paymentId: z.uuid(),
  gateway: PaymentGatewaySchema,
  /** Where the browser submits the fields (form POST). */
  checkoutUrl: z.url(),
  method: z.literal('POST'),
  /** Gateway form fields, including the server-computed `hash`; never the merchant secret. */
  fields: z.record(z.string(), z.string()),
  amount: LkrAmountSchema,
  currency: SettlementCurrencySchema,
  expiresAt: z.iso.datetime(),
});
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

/** One payment attempt as the customer or admin sees it. */
export const PaymentSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  type: PaymentTypeSchema,
  gateway: PaymentGatewaySchema,
  status: PaymentStatusSchema,
  amount: LkrAmountSchema,
  currency: SettlementCurrencySchema,
  orderId: z.string(),
  /** Gateway's own payment id once the gateway reported it (null before). */
  gatewayPaymentId: z.string().nullable(),
  /** Gateway status code of the last verified notification (e.g. PayHere `2`). */
  gatewayStatusCode: z.string().nullable(),
  /** Payment method reported by the gateway (VISA, MASTER, GENIE…), never card numbers. */
  gatewayMethod: z.string().nullable(),
  failureReason: z.string().nullable(),
  anomaly: PaymentAnomalySchema.nullable(),
  requiresManualResolution: z.boolean(),
  refundDueAmount: LkrAmountSchema.nullable(),
  refundedAmount: LkrAmountSchema.nullable(),
  refundReference: z.string().nullable(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  refundedAt: z.iso.datetime().nullable(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const PaymentListSchema = z.object({ data: z.array(PaymentSchema) });
export type PaymentList = z.infer<typeof PaymentListSchema>;

/** Append-only audit row of a payment (admin view). */
export const PaymentEventSchema = z.object({
  id: z.uuid(),
  /** e.g. `payment.checkout_created`, `payment.notification_received`, `payment.paid`. */
  action: z.string(),
  actorType: z.enum(['customer', 'admin', 'gateway', 'system']),
  gatewayPaymentId: z.string().nullable(),
  statusCode: z.string().nullable(),
  signatureValid: z.boolean().nullable(),
  /** Codes, ids and amounts only; never secrets, signatures or card data. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;

export const AdminPaymentSchema = PaymentSchema.extend({
  events: z.array(PaymentEventSchema),
});
export type AdminPayment = z.infer<typeof AdminPaymentSchema>;

export const AdminPaymentListItemSchema = AdminPaymentSchema.extend({
  bookingReference: z.string(),
});
export type AdminPaymentListItem = z.infer<typeof AdminPaymentListItemSchema>;

export const AdminPaymentListSchema = z.object({ data: z.array(AdminPaymentListItemSchema) });
export type AdminPaymentList = z.infer<typeof AdminPaymentListSchema>;

/** `POST /admin/payments/{id}/refund`: record (manual) or execute (gateway) a refund of a paid advance. */
export const RecordRefundRequestSchema = z
  .strictObject({
    /** `manual`: the admin refunded outside the platform (PayHere portal, bank transfer) and records it. `gateway`: call the gateway Refund API. */
    mode: z.enum(['manual', 'gateway']),
    amount: LkrAmountSchema,
    reason: z.string().trim().min(5).max(500),
    /** Portal / bank reference for manual refunds. */
    reference: z.string().trim().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'manual' && !v.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'a portal or bank reference is required for a manual refund',
      });
    }
  });
export type RecordRefundRequest = z.infer<typeof RecordRefundRequestSchema>;

/** `POST /admin/payments/{id}/resolve`: clears the manual-resolution flag with a note. */
export const ResolvePaymentRequestSchema = z.strictObject({
  note: z.string().trim().min(5).max(500),
});
export type ResolvePaymentRequest = z.infer<typeof ResolvePaymentRequestSchema>;

/** Result of an admin reconciliation call against the gateway's Retrieval API. */
export const PaymentReconciliationSchema = z.object({
  paymentId: z.uuid(),
  gateway: PaymentGatewaySchema,
  /** Status reported by the gateway, or null when the gateway knows no such order. */
  gatewayStatus: z.string().nullable(),
  gatewayPaymentId: z.string().nullable(),
  gatewayAmount: z.string().nullable(),
  gatewayCurrency: z.string().nullable(),
  matches: z.boolean(),
  checkedAt: z.iso.datetime(),
});
export type PaymentReconciliation = z.infer<typeof PaymentReconciliationSchema>;
