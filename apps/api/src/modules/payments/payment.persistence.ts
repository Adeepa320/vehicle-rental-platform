import { amountToCents, type BookingPaymentSummary, type PaymentGatewayName } from '@vrp/contracts';
import {
  paymentEvents,
  payments,
  type Booking,
  type DatabaseExecutor,
  type PaymentEventRow,
  type PaymentRow,
} from '@vrp/database';
import { and, asc, eq, inArray } from 'drizzle-orm';

/** Shared read/write helpers for payments; every function takes the caller's executor. */

export async function loadPaymentsForBookings(
  executor: DatabaseExecutor,
  bookingIds: readonly string[],
): Promise<Map<string, PaymentRow[]>> {
  const map = new Map<string, PaymentRow[]>();
  if (bookingIds.length === 0) return map;
  const rows = await executor
    .select()
    .from(payments)
    .where(inArray(payments.bookingId, [...bookingIds]))
    .orderBy(asc(payments.createdAt), asc(payments.id));
  for (const row of rows) {
    const list = map.get(row.bookingId) ?? [];
    list.push(row);
    map.set(row.bookingId, list);
  }
  return map;
}

export async function loadPaymentEventsFor(
  executor: DatabaseExecutor,
  paymentIds: readonly string[],
): Promise<Map<string, PaymentEventRow[]>> {
  const map = new Map<string, PaymentEventRow[]>();
  if (paymentIds.length === 0) return map;
  const rows = await executor
    .select()
    .from(paymentEvents)
    .where(inArray(paymentEvents.paymentId, [...paymentIds]))
    .orderBy(asc(paymentEvents.createdAt), asc(paymentEvents.id));
  for (const row of rows) {
    if (!row.paymentId) continue;
    const list = map.get(row.paymentId) ?? [];
    list.push(row);
    map.set(row.paymentId, list);
  }
  return map;
}

export interface PaymentEventInput {
  paymentId?: string | null;
  bookingId?: string | null;
  gateway: PaymentGatewayName;
  /** Dotted verb, e.g. `payment.checkout_created`, `payment.notification_received`, `payment.paid`. */
  action: string;
  actorType: 'customer' | 'admin' | 'gateway' | 'system';
  actorUserId?: string | null;
  orderId?: string | null;
  gatewayPaymentId?: string | null;
  statusCode?: string | null;
  signatureValid?: boolean | null;
  /** Codes, ids and amounts only; never secrets, signatures, raw payloads or card data. */
  metadata?: Record<string, unknown>;
}

/** Appends to the payment audit trail; call inside the transaction of the change. */
export async function recordPaymentEvent(
  executor: DatabaseExecutor,
  input: PaymentEventInput,
): Promise<void> {
  await executor.insert(paymentEvents).values({
    paymentId: input.paymentId ?? null,
    bookingId: input.bookingId ?? null,
    gateway: input.gateway,
    action: input.action,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    orderId: input.orderId ?? null,
    gatewayPaymentId: input.gatewayPaymentId ?? null,
    statusCode: input.statusCode ?? null,
    signatureValid: input.signatureValid ?? null,
    metadata: input.metadata ?? null,
  });
}

/** The successful advance of a booking, if any (anomalous late/duplicate successes do not count). */
export function successfulAdvance(rows: readonly PaymentRow[]): PaymentRow | undefined {
  return rows.find(
    (r) =>
      (r.status === 'paid' || r.status === 'refunded') &&
      (r.anomaly === null || r.anomaly === 'refund_due' || r.anomaly === 'chargeback'),
  );
}

/** What every booking view says about the advance (role-neutral: no ids, no gateway details). */
export function paymentSummaryFor(
  booking: Pick<Booking, 'advanceAmount'>,
  rows: readonly PaymentRow[],
): BookingPaymentSummary {
  const base = {
    advanceAmount: booking.advanceAmount,
    currency: 'LKR' as const,
    paidAt: null,
    refundDueAmount: null,
    refundedAt: null,
  };
  // Prefer the clean success; otherwise money that was still taken (late / duplicate success) counts too:
  // the customer must see the refund due, not "advance not paid".
  const paid =
    successfulAdvance(rows) ??
    [...rows].reverse().find((r) => r.status === 'paid' || r.status === 'refunded');
  if (paid) {
    const refundDue =
      paid.refundDueAmount !== null && amountToCents(paid.refundDueAmount) > 0n
        ? paid.refundDueAmount
        : null;
    return {
      ...base,
      state:
        paid.status === 'refunded'
          ? 'refunded'
          : refundDue
            ? 'refund_due'
            : paid.refundDueAmount !== null
              ? 'forfeited' // settlement wrote 0.00: cancelled too close to pickup
              : 'paid',
      paidAt: paid.paidAt ? paid.paidAt.toISOString() : null,
      refundDueAmount: paid.status === 'refunded' ? null : refundDue,
      refundedAt: paid.refundedAt ? paid.refundedAt.toISOString() : null,
    };
  }
  const latest = rows.at(-1);
  if (!latest) return { ...base, state: 'not_started' };
  if (latest.status === 'pending') return { ...base, state: 'pending' };
  if (latest.status === 'failed') return { ...base, state: 'failed' };
  if (latest.status === 'cancelled') return { ...base, state: 'cancelled' };
  return { ...base, state: 'not_started' };
}

/** Marks every pending attempt of a booking as cancelled (booking expired or cancelled). */
export async function cancelPendingPayments(
  executor: DatabaseExecutor,
  bookingId: string,
  reason: 'booking_expired' | 'booking_cancelled',
  now: Date,
): Promise<PaymentRow[]> {
  const cancelled = await executor
    .update(payments)
    .set({ status: 'cancelled', cancelledAt: now, failureReason: reason })
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, 'pending')))
    .returning();
  for (const row of cancelled) {
    await recordPaymentEvent(executor, {
      paymentId: row.id,
      bookingId,
      gateway: row.gateway as PaymentGatewayName,
      action: 'payment.cancelled',
      actorType: 'system',
      orderId: row.orderId,
      metadata: { reason },
    });
  }
  return cancelled;
}

export interface CancellationSettlementInput {
  cancelledBy: 'customer' | 'provider';
  /** Hours before pickup within which a customer cancellation still gets a full refund. */
  fullRefundHours: number;
  now: Date;
}

export interface CancellationSettlement {
  /** Amount owed back to the customer (null when nothing was paid). */
  refundDueAmount: string | null;
  /** Whether the paid advance is forfeited under the policy. */
  forfeited: boolean;
  paidPaymentId: string | null;
}

/**
 * Applies the simple MVP cancellation policy to a booking's payments
 * (USER_FLOWS §1.7): pending attempts are cancelled; a paid advance becomes
 * refund-due in full when the provider cancels, or when the customer cancels at
 * least `fullRefundHours` before pickup, and is forfeited otherwise. Money is
 * never moved here; an admin records the actual refund later.
 */
export async function settlePaymentsOnCancellation(
  executor: DatabaseExecutor,
  booking: Pick<Booking, 'id' | 'startsAt'>,
  input: CancellationSettlementInput,
): Promise<CancellationSettlement> {
  await cancelPendingPayments(executor, booking.id, 'booking_cancelled', input.now);
  const rows = await executor
    .select()
    .from(payments)
    .where(eq(payments.bookingId, booking.id))
    .for('update');
  const paid = successfulAdvance(rows);
  if (!paid || paid.status !== 'paid') {
    return { refundDueAmount: null, forfeited: false, paidPaymentId: paid?.id ?? null };
  }
  const hoursBeforePickup = (booking.startsAt.getTime() - input.now.getTime()) / 3_600_000;
  const fullRefund = input.cancelledBy === 'provider' || hoursBeforePickup >= input.fullRefundHours;
  const refundDueAmount = fullRefund ? paid.amount : '0.00';
  await executor
    .update(payments)
    .set({
      refundDueAmount,
      ...(fullRefund ? { anomaly: 'refund_due', requiresManualResolution: true } : {}),
    })
    .where(eq(payments.id, paid.id));
  await recordPaymentEvent(executor, {
    paymentId: paid.id,
    bookingId: booking.id,
    gateway: paid.gateway as PaymentGatewayName,
    action: fullRefund ? 'payment.refund_due' : 'payment.refund_forfeited',
    actorType: 'system',
    orderId: paid.orderId,
    metadata: {
      cancelledBy: input.cancelledBy,
      refundDueAmount,
      fullRefundHours: input.fullRefundHours,
      hoursBeforePickup: Math.round(hoursBeforePickup * 100) / 100,
    },
  });
  return { refundDueAmount, forfeited: !fullRefund, paidPaymentId: paid.id };
}
