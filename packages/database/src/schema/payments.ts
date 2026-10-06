import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { bookings } from './bookings';
import { users } from './users';

const tz = { withTimezone: true } as const;
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

export const paymentType = pgEnum('payment_type', ['advance']);
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refunded',
]);

/**
 * One online payment attempt (DATABASE_DESIGN §6.8, lean Phase 7). Only the
 * `advance` type exists; the balance and deposit are settled in person. The
 * gateway `order_id` is ours and unique; the gateway's own `payment_id` is
 * unique per gateway so a replayed notification can never become a second
 * successful payment. At most one `pending` and one `paid` advance per booking.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    type: paymentType('type').notNull().default('advance'),
    /** `payhere` | `fake` (tests and local development). */
    gateway: text('gateway').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    currency: text('currency').notNull().default('LKR'),
    amount: money('amount').notNull(),
    /** Our order id sent to the gateway (`ADV-…`). */
    orderId: text('order_id').notNull(),
    gatewayPaymentId: text('gateway_payment_id'),
    gatewayStatusCode: text('gateway_status_code'),
    gatewayMethod: text('gateway_method'),
    failureReason: text('failure_reason'),
    /** `amount_mismatch` | `currency_mismatch` | `late_success` | `chargeback` | `refund_due`. */
    anomaly: text('anomaly'),
    requiresManualResolution: boolean('requires_manual_resolution').notNull().default(false),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamp('resolved_at', tz),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    /** Owed back to the customer after a cancellation until the refund is recorded. */
    refundDueAmount: money('refund_due_amount'),
    refundedAmount: money('refunded_amount'),
    refundReference: text('refund_reference'),
    refundReason: text('refund_reason'),
    refundedBy: uuid('refunded_by').references(() => users.id, { onDelete: 'set null' }),
    paidAt: timestamp('paid_at', tz),
    failedAt: timestamp('failed_at', tz),
    cancelledAt: timestamp('cancelled_at', tz),
    refundedAt: timestamp('refunded_at', tz),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('payments_order_id_key').on(t.orderId),
    uniqueIndex('payments_gateway_payment_id_key')
      .on(t.gateway, t.gatewayPaymentId)
      .where(sql`${t.gatewayPaymentId} is not null`),
    uniqueIndex('payments_one_pending_advance_key')
      .on(t.bookingId)
      .where(sql`${t.type} = 'advance' and ${t.status} = 'pending'`),
    // One *clean* successful advance per booking; a late or duplicate success is still stored as
    // `paid` (the money was taken) but carries an anomaly and never confirms the booking.
    uniqueIndex('payments_one_paid_advance_key')
      .on(t.bookingId)
      .where(
        sql`${t.type} = 'advance' and ${t.status} in ('paid', 'refunded') and ${t.anomaly} is null`,
      ),
    index('payments_booking_idx').on(t.bookingId, t.createdAt),
    index('payments_manual_resolution_idx')
      .on(t.createdAt)
      .where(sql`${t.requiresManualResolution} = true`),
    check('payments_amount_check', sql`${t.amount} > 0`),
    check(
      'payments_refund_amounts_check',
      sql`(${t.refundDueAmount} is null or ${t.refundDueAmount} >= 0) and (${t.refundedAmount} is null or (${t.refundedAmount} >= 0 and ${t.refundedAmount} <= ${t.amount}))`,
    ),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];

/**
 * Append-only payment audit trail (the design's `payment_webhook_events`,
 * generalised): every checkout, every gateway notification (valid or not),
 * every state change and every admin refund record. `payment_id` is null when
 * a notification names an unknown order. An UPDATE trigger refuses changes.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    gateway: text('gateway').notNull(),
    /** Dotted verb, e.g. `payment.checkout_created`, `payment.notification_received`, `payment.paid`. */
    action: text('action').notNull(),
    /** `customer` | `admin` | `gateway` | `system` */
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    orderId: text('order_id'),
    gatewayPaymentId: text('gateway_payment_id'),
    statusCode: text('status_code'),
    signatureValid: boolean('signature_valid'),
    /** Codes, ids and amounts only; never secrets, signatures, raw payloads or card data. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [
    index('payment_events_payment_idx').on(t.paymentId, t.createdAt),
    index('payment_events_booking_idx').on(t.bookingId, t.createdAt),
  ],
);

export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type NewPaymentEventRow = typeof paymentEvents.$inferInsert;
