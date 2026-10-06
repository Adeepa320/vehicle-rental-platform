import {
  PaymentAnomalySchema,
  PaymentGatewaySchema,
  type AdminPayment,
  type Payment,
  type PaymentEvent,
} from '@vrp/contracts';
import type { PaymentEventRow, PaymentRow } from '@vrp/database';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Allow-list projection: no secrets, no raw payloads, no card data (none is stored anyway). */
export function toPayment(row: PaymentRow): Payment {
  const gateway = PaymentGatewaySchema.safeParse(row.gateway);
  const anomaly = PaymentAnomalySchema.safeParse(row.anomaly);
  return {
    id: row.id,
    bookingId: row.bookingId,
    type: row.type,
    gateway: gateway.success ? gateway.data : 'payhere',
    status: row.status,
    amount: row.amount,
    currency: 'LKR',
    orderId: row.orderId,
    gatewayPaymentId: row.gatewayPaymentId,
    gatewayStatusCode: row.gatewayStatusCode,
    gatewayMethod: row.gatewayMethod,
    failureReason: row.failureReason,
    anomaly: anomaly.success ? anomaly.data : null,
    requiresManualResolution: row.requiresManualResolution,
    refundDueAmount: row.refundDueAmount,
    refundedAmount: row.refundedAmount,
    refundReference: row.refundReference,
    createdAt: row.createdAt.toISOString(),
    paidAt: iso(row.paidAt),
    failedAt: iso(row.failedAt),
    cancelledAt: iso(row.cancelledAt),
    refundedAt: iso(row.refundedAt),
  };
}

export function toPaymentEvent(row: PaymentEventRow): PaymentEvent {
  const actor = row.actorType;
  return {
    id: row.id,
    action: row.action,
    actorType: actor === 'customer' || actor === 'admin' || actor === 'gateway' ? actor : 'system',
    gatewayPaymentId: row.gatewayPaymentId,
    statusCode: row.statusCode,
    signatureValid: row.signatureValid,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminPayment(row: PaymentRow, events: PaymentEventRow[]): AdminPayment {
  return { ...toPayment(row), events: events.map(toPaymentEvent) };
}
