import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CURRENCY,
  amountToCents,
  compareAmounts,
  isAmount,
  normalizeAmount,
  type AdminPayment,
  type CheckoutSession,
  type Payment,
  type PaymentAnomaly,
  type PaymentGatewayName,
  type PaymentReconciliation,
  type RecordRefundRequest,
  type ResolvePaymentRequest,
} from '@vrp/contracts';
import {
  bookings,
  payments,
  type Booking as BookingRow,
  type Database,
  type DatabaseExecutor,
  type PaymentRow,
} from '@vrp/database';
import { and, desc, eq, ne } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import {
  bookingEmailBase,
  holdOfBooking,
  loadBookingContext,
  lockBooking,
  type BookingContext,
} from '../bookings/booking.persistence';
import { BookingsService } from '../bookings/bookings.service';
import { EmailService } from '../notifications/email/email.service';
import {
  paymentAnomalyOperatorEmail,
  paymentFailedEmail,
  paymentLateSuccessEmail,
  paymentRefundRecordedEmail,
} from '../notifications/email/payment-templates';
import {
  PAYMENT_GATEWAY,
  type GatewayNotification,
  type PaymentGateway,
} from './gateway/payment-gateway';
import { toAdminPayment, toPayment } from './payment.mappers';
import {
  loadPaymentEventsFor,
  loadPaymentsForBookings,
  recordPaymentEvent,
  successfulAdvance,
} from './payment.persistence';

const ORDER_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export type NotificationResult =
  'rejected' | 'unknown_order' | 'processed' | 'replayed' | 'ignored' | 'anomaly';

/**
 * Online advance payments (TECH_DECISIONS D53–D56). The service owns every
 * payment row and drives the gateway abstraction; bookings are confirmed only
 * through `BookingsService.confirmFromPayment` after a verified, matching,
 * first-time successful notification. Every step appends to `payment_events`.
 */
@Injectable()
export class PaymentsService {
  private readonly webAppUrl: string;
  private readonly apiPublicUrl: string;
  private readonly notifyUrl: string;
  private readonly operatorEmail: string | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly bookings: BookingsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentsService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    this.apiPublicUrl = config.get('API_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
    this.notifyUrl =
      config.get('PAYHERE_NOTIFY_URL', { infer: true }) ??
      `${this.apiPublicUrl}/payments/payhere/notify`;
    this.operatorEmail = config.get('OPERATOR_NOTIFICATION_EMAIL', { infer: true });
  }

  get gatewayName(): PaymentGatewayName {
    return this.gateway.name;
  }

  // ============================================================= checkout

  /**
   * Creates (or reuses) the pending advance payment of an accepted booking and
   * returns the gateway form. The amount is the booking's snapshot, never a
   * client value; a retry reuses the open attempt instead of multiplying rows.
   */
  async createCheckout(
    customer: AuthenticatedUser,
    bookingId: string,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<CheckoutSession> {
    const session = await this.db.transaction(async (tx): Promise<CheckoutSession> => {
      const booking = await lockBooking(tx, bookingId, { customerUserId: customer.id });
      if (!booking) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      const rows = await tx
        .select()
        .from(payments)
        .where(eq(payments.bookingId, bookingId))
        .orderBy(desc(payments.createdAt));
      if (successfulAdvance(rows)) {
        throw new ApiException(
          'ALREADY_PAID',
          'The advance for this booking has already been paid',
          409,
        );
      }
      if (booking.status !== 'accepted') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `Only accepted bookings can be paid (this one is ${booking.status.replaceAll('_', ' ')})`,
          409,
        );
      }
      if (booking.confirmBy && booking.confirmBy <= now) {
        throw new ApiException(
          'PAYMENT_WINDOW_EXPIRED',
          'The payment window for this booking has closed',
          410,
        );
      }
      if (!(await holdOfBooking(tx, bookingId))) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'The vehicle is no longer reserved for this booking',
          409,
        );
      }
      if (amountToCents(booking.advanceAmount) <= 0n) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'This booking has no advance to pay',
          409,
        );
      }

      let payment = rows.find((r) => r.status === 'pending');
      let reused = true;
      if (!payment) {
        reused = false;
        const orderId = await this.uniqueOrderId(tx, booking.reference);
        [payment] = await tx
          .insert(payments)
          .values({
            bookingId,
            type: 'advance',
            gateway: this.gateway.name,
            status: 'pending',
            currency: CURRENCY,
            amount: booking.advanceAmount,
            orderId,
          })
          .returning();
        if (!payment) throw new Error('Failed to create payment');
        await recordPaymentEvent(tx, {
          paymentId: payment.id,
          bookingId,
          gateway: this.gateway.name,
          action: 'payment.checkout_created',
          actorType: 'customer',
          actorUserId: customer.id,
          orderId,
          metadata: { amount: payment.amount, currency: payment.currency },
        });
      }

      const ctx = await loadBookingContext(tx, eq(bookings.id, bookingId));
      if (!ctx) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      const [firstName, ...rest] = ctx.customer.fullName.trim().split(/\s+/);
      const checkout = this.gateway.createCheckout({
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
        items: `Booking ${booking.reference} advance`,
        customer: {
          firstName: firstName ?? 'Customer',
          lastName: rest.join(' ') || (firstName ?? 'Customer'),
          email: ctx.customer.email,
          phone: ctx.customer.phoneE164 ?? '',
          // PayHere requires address/city/country; the platform does not collect a postal address.
          address: 'Not provided',
          city: ctx.placeName,
          country: 'Sri Lanka',
        },
        returnUrl: `${this.webAppUrl}/bookings/${bookingId}/payment?result=return`,
        cancelUrl: `${this.webAppUrl}/bookings/${bookingId}/payment?result=cancel`,
        notifyUrl: this.notifyUrl,
        custom1: bookingId,
        custom2: payment.id,
      });
      await recordPaymentEvent(tx, {
        paymentId: payment.id,
        bookingId,
        gateway: this.gateway.name,
        action: 'payment.checkout_issued',
        actorType: 'customer',
        actorUserId: customer.id,
        orderId: payment.orderId,
        metadata: {
          reused,
          amount: payment.amount,
          currency: payment.currency,
          ip: meta.ip ?? null,
        },
      });
      this.logger.info(
        { bookingId, paymentId: payment.id, orderId: payment.orderId, reused },
        'Payment checkout issued',
      );
      return {
        paymentId: payment.id,
        gateway: this.gateway.name,
        checkoutUrl: checkout.checkoutUrl,
        method: 'POST',
        fields: checkout.fields,
        amount: payment.amount,
        currency: CURRENCY,
        expiresAt: (booking.confirmBy ?? booking.startsAt).toISOString(),
      };
    });
    return session;
  }

  /** The customer's payment attempts for one of their bookings. */
  async listForCustomer(customer: AuthenticatedUser, bookingId: string): Promise<Payment[]> {
    const [booking] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.customerUserId, customer.id)))
      .limit(1);
    if (!booking) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    const rows = (await loadPaymentsForBookings(this.db, [bookingId])).get(bookingId) ?? [];
    return rows.map(toPayment);
  }

  // ========================================================= notifications

  /**
   * Gateway server callback. Verification first; then, under the booking and
   * payment row locks, exactly-once processing of each outcome. Always
   * resolves (the controller answers 200) so a retry storm cannot start.
   */
  async handleNotification(
    body: Record<string, unknown>,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<NotificationResult> {
    const n = this.gateway.parseNotification(body);
    if (!n.signatureValid || !n.merchantMatches) {
      const [known] = n.orderId
        ? await this.db
            .select({ id: payments.id, bookingId: payments.bookingId })
            .from(payments)
            .where(eq(payments.orderId, n.orderId))
            .limit(1)
        : [];
      await recordPaymentEvent(this.db, {
        paymentId: known?.id ?? null,
        bookingId: known?.bookingId ?? null,
        gateway: this.gateway.name,
        action: 'payment.notification_rejected',
        actorType: 'gateway',
        orderId: n.orderId || null,
        gatewayPaymentId: n.gatewayPaymentId,
        statusCode: n.statusCode || null,
        signatureValid: n.signatureValid,
        metadata: {
          reason: n.signatureValid ? 'merchant_mismatch' : 'invalid_signature',
          ip: meta.ip ?? null,
        },
      });
      this.logger.warn(
        {
          orderId: n.orderId || null,
          reason: n.signatureValid ? 'merchant_mismatch' : 'invalid_signature',
        },
        'Payment notification rejected',
      );
      return 'rejected';
    }

    return this.db.transaction(async (tx): Promise<NotificationResult> => {
      const [peek] = await tx
        .select({ id: payments.id, bookingId: payments.bookingId })
        .from(payments)
        .where(eq(payments.orderId, n.orderId))
        .limit(1);
      if (!peek) {
        await recordPaymentEvent(tx, {
          gateway: this.gateway.name,
          action: 'payment.notification_rejected',
          actorType: 'gateway',
          orderId: n.orderId,
          gatewayPaymentId: n.gatewayPaymentId,
          statusCode: n.statusCode,
          signatureValid: true,
          metadata: { reason: 'unknown_order', outcome: n.outcome },
        });
        this.logger.warn({ orderId: n.orderId }, 'Payment notification for unknown order');
        return 'unknown_order';
      }
      // Lock order: booking first, then the payment (same as checkout and cancellation).
      const booking = await lockBooking(tx, peek.bookingId);
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, peek.id))
        .for('update');
      if (!booking || !payment) throw new Error('Payment row vanished during notification');

      await recordPaymentEvent(tx, {
        paymentId: payment.id,
        bookingId: booking.id,
        gateway: this.gateway.name,
        action: 'payment.notification_received',
        actorType: 'gateway',
        orderId: payment.orderId,
        gatewayPaymentId: n.gatewayPaymentId,
        statusCode: n.statusCode,
        signatureValid: true,
        metadata: {
          outcome: n.outcome,
          amount: n.amount,
          currency: n.currency,
          method: n.method,
          paymentStatusBefore: payment.status,
        },
      });

      switch (n.outcome) {
        case 'paid':
          return this.applySuccess(tx, booking, payment, n, now);
        case 'failed':
        case 'cancelled':
          return this.applyFailure(tx, booking, payment, n, now);
        case 'chargedback':
          return this.applyChargeback(tx, booking, payment, n);
        case 'pending':
        case 'unknown':
        default:
          return 'ignored';
      }
    });
  }

  private async applySuccess(
    tx: DatabaseExecutor,
    booking: BookingRow,
    payment: PaymentRow,
    n: GatewayNotification,
    now: Date,
  ): Promise<NotificationResult> {
    if (payment.status === 'paid' || payment.status === 'refunded') {
      if (payment.gatewayPaymentId === n.gatewayPaymentId) {
        await this.event(tx, payment, 'payment.notification_replayed', n);
        return 'replayed';
      }
      // A second, different success for an order that was already paid: money may have been taken twice.
      await tx
        .update(payments)
        .set({ anomaly: payment.anomaly ?? 'duplicate_payment', requiresManualResolution: true })
        .where(eq(payments.id, payment.id));
      await this.event(tx, payment, 'payment.anomaly', n, {
        reason: 'duplicate_payment',
        previousGatewayPaymentId: payment.gatewayPaymentId,
      });
      await this.notifyOperator(tx, booking, payment, 'duplicate_payment', n);
      return 'anomaly';
    }

    // Amount and currency must match the persisted attempt exactly.
    const amountOk =
      isAmount(n.amount) && compareAmounts(normalizeAmount(n.amount), payment.amount) === 0;
    const currencyOk = n.currency === payment.currency;
    if (!amountOk || !currencyOk) {
      const anomaly: PaymentAnomaly = amountOk ? 'currency_mismatch' : 'amount_mismatch';
      await tx
        .update(payments)
        .set({
          anomaly,
          requiresManualResolution: true,
          gatewayStatusCode: n.statusCode,
          gatewayMethod: n.method,
          gatewayPaymentId:
            payment.gatewayPaymentId ?? (await this.freeGatewayPaymentId(tx, payment, n)),
        })
        .where(eq(payments.id, payment.id));
      await this.event(tx, payment, 'payment.anomaly', n, {
        reason: anomaly,
        expectedAmount: payment.amount,
        expectedCurrency: payment.currency,
        reportedAmount: n.amount,
        reportedCurrency: n.currency,
      });
      await this.notifyOperator(tx, booking, payment, anomaly, n);
      return 'anomaly';
    }

    // The gateway payment id must not already belong to another attempt (replay against a different order).
    if (n.gatewayPaymentId) {
      const [clash] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.gateway, payment.gateway),
            eq(payments.gatewayPaymentId, n.gatewayPaymentId),
            ne(payments.id, payment.id),
          ),
        )
        .limit(1);
      if (clash) {
        await this.event(tx, payment, 'payment.notification_rejected', n, {
          reason: 'gateway_payment_id_in_use',
          otherPaymentId: clash.id,
        });
        return 'ignored';
      }
    }

    const confirmation = await this.bookings.confirmFromPayment(
      tx,
      booking.id,
      {
        paymentId: payment.id,
        gateway: payment.gateway,
        gatewayPaymentId: n.gatewayPaymentId,
        amount: payment.amount,
      },
      now,
    );
    if (confirmation.confirmed) {
      await tx
        .update(payments)
        .set({
          status: 'paid',
          paidAt: now,
          gatewayPaymentId: n.gatewayPaymentId,
          gatewayStatusCode: n.statusCode,
          gatewayMethod: n.method,
          failureReason: null,
          failedAt: null,
          cancelledAt: null,
          // An earlier mismatching message is superseded by this matching, verified success.
          anomaly: null,
          requiresManualResolution: false,
        })
        .where(eq(payments.id, payment.id));
      await this.event(tx, payment, 'payment.paid', n, { amount: payment.amount });
      await this.event(tx, payment, 'payment.booking_confirmed', n, { bookingId: booking.id });
      this.logger.info(
        { bookingId: booking.id, paymentId: payment.id, gateway: payment.gateway },
        'Payment received; booking confirmed',
      );
      return 'processed';
    }

    // Money was taken but the booking can no longer be confirmed (expired, cancelled, already confirmed…).
    const anomaly: PaymentAnomaly =
      confirmation.reason === 'booking_confirmed' ? 'duplicate_payment' : 'late_success';
    await tx
      .update(payments)
      .set({
        status: 'paid',
        paidAt: now,
        gatewayPaymentId: n.gatewayPaymentId,
        gatewayStatusCode: n.statusCode,
        gatewayMethod: n.method,
        anomaly,
        requiresManualResolution: true,
        refundDueAmount: payment.amount,
      })
      .where(eq(payments.id, payment.id));
    await this.event(tx, payment, 'payment.anomaly', n, {
      reason: anomaly,
      bookingStatus: booking.status,
      detail: confirmation.reason,
      refundDueAmount: payment.amount,
    });
    await this.notifyOperator(tx, booking, payment, anomaly, n);
    const ctx = await loadBookingContext(tx, eq(bookings.id, booking.id));
    if (ctx && anomaly === 'late_success') {
      await this.email.enqueue(
        paymentLateSuccessEmail({
          ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/bookings/${booking.id}`),
          amount: payment.amount,
          bookingStatus: booking.status,
        }),
        tx,
      );
    }
    this.logger.warn(
      { bookingId: booking.id, paymentId: payment.id, anomaly, bookingStatus: booking.status },
      'Verified payment could not confirm its booking',
    );
    return 'anomaly';
  }

  private async applyFailure(
    tx: DatabaseExecutor,
    booking: BookingRow,
    payment: PaymentRow,
    n: GatewayNotification,
    now: Date,
  ): Promise<NotificationResult> {
    if (payment.status === 'paid' || payment.status === 'refunded') {
      // A verified success is never downgraded by a later failure/cancel message.
      await this.event(tx, payment, 'payment.notification_ignored', n, {
        reason: 'stale_after_success',
      });
      return 'ignored';
    }
    if (payment.status !== 'pending') {
      await this.event(tx, payment, 'payment.notification_replayed', n);
      return 'replayed';
    }
    const status = n.outcome === 'cancelled' ? 'cancelled' : 'failed';
    await tx
      .update(payments)
      .set({
        status,
        ...(status === 'cancelled' ? { cancelledAt: now } : { failedAt: now }),
        gatewayPaymentId:
          payment.gatewayPaymentId ?? (await this.freeGatewayPaymentId(tx, payment, n)),
        gatewayStatusCode: n.statusCode,
        gatewayMethod: n.method,
        failureReason: n.statusMessage ?? status,
      })
      .where(eq(payments.id, payment.id));
    await this.event(tx, payment, `payment.${status}`, n);
    const ctx = await loadBookingContext(tx, eq(bookings.id, booking.id));
    if (ctx && booking.status === 'accepted') {
      await this.email.enqueue(
        paymentFailedEmail({
          ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/bookings/${booking.id}`),
          outcome: status,
          confirmBy: booking.confirmBy,
        }),
        tx,
      );
    }
    return 'processed';
  }

  private async applyChargeback(
    tx: DatabaseExecutor,
    booking: BookingRow,
    payment: PaymentRow,
    n: GatewayNotification,
  ): Promise<NotificationResult> {
    if (payment.status !== 'paid') {
      await this.event(tx, payment, 'payment.notification_ignored', n, {
        reason: 'chargeback_without_payment',
      });
      return 'ignored';
    }
    await tx
      .update(payments)
      .set({
        anomaly: 'chargeback',
        requiresManualResolution: true,
        gatewayStatusCode: n.statusCode,
      })
      .where(eq(payments.id, payment.id));
    await this.event(tx, payment, 'payment.anomaly', n, { reason: 'chargeback' });
    await this.notifyOperator(tx, booking, payment, 'chargeback', n);
    return 'anomaly';
  }

  // ================================================================ admin

  async getForAdmin(id: string): Promise<AdminPayment & { bookingReference: string }> {
    const [row] = await this.db
      .select({ payment: payments, reference: bookings.reference })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(eq(payments.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Payment not found', 404);
    const events = (await loadPaymentEventsFor(this.db, [id])).get(id) ?? [];
    return { ...toAdminPayment(row.payment, events), bookingReference: row.reference };
  }

  async listNeedingResolution(
    limit = 50,
  ): Promise<(AdminPayment & { bookingReference: string })[]> {
    const rows = await this.db
      .select({ payment: payments, reference: bookings.reference })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(eq(payments.requiresManualResolution, true))
      .orderBy(desc(payments.createdAt))
      .limit(limit);
    const events = await loadPaymentEventsFor(
      this.db,
      rows.map((r) => r.payment.id),
    );
    return rows.map((r) => ({
      ...toAdminPayment(r.payment, events.get(r.payment.id) ?? []),
      bookingReference: r.reference,
    }));
  }

  /**
   * Records a refund of a paid advance. `manual`: the admin already refunded
   * through the PayHere portal or by bank transfer and records the reference.
   * `gateway`: the gateway's Refund API is called first (needs merchant-API
   * credentials; refused with 503 otherwise). Never pretends a refund happened.
   */
  async recordRefund(
    admin: AuthenticatedUser,
    id: string,
    input: RecordRefundRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminPayment & { bookingReference: string }> {
    const current = await this.getRow(id);
    if (current.status !== 'paid') {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `Only a paid advance can be refunded (this payment is ${current.status})`,
        409,
      );
    }
    const alreadyRefunded = current.refundedAmount ? amountToCents(current.refundedAmount) : 0n;
    if (amountToCents(input.amount) + alreadyRefunded > amountToCents(current.amount)) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'amount', issue: 'exceeds the amount paid' },
      ]);
    }
    let reference = input.reference ?? '';
    if (input.mode === 'gateway') {
      if (!this.gateway.canRefund) {
        throw new ApiException(
          'PAYMENT_GATEWAY_UNAVAILABLE',
          'Gateway refunds are not configured; refund through the merchant portal and record it manually',
          503,
        );
      }
      if (!current.gatewayPaymentId) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'The payment has no gateway payment id',
          409,
        );
      }
      reference = (await this.gateway.refund(current.gatewayPaymentId, input.amount, input.reason))
        .reference;
    }

    await this.db.transaction(async (tx) => {
      await lockBooking(tx, current.bookingId);
      const [locked] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
      if (!locked || locked.status !== 'paid') {
        throw new ApiException('INVALID_STATE_TRANSITION', 'The payment changed; reload', 409);
      }
      const refundedTotal =
        (locked.refundedAmount ? amountToCents(locked.refundedAmount) : 0n) +
        amountToCents(input.amount);
      const full = refundedTotal >= amountToCents(locked.amount);
      await tx
        .update(payments)
        .set({
          status: full ? 'refunded' : 'paid',
          refundedAmount: normalizeAmount(String(Number(refundedTotal) / 100)),
          refundedAt: now,
          refundedBy: admin.id,
          refundReference: reference,
          refundReason: input.reason,
          refundDueAmount: full ? '0.00' : locked.refundDueAmount,
          requiresManualResolution: false,
          anomaly: full ? null : locked.anomaly,
          resolvedAt: now,
          resolvedBy: admin.id,
          resolutionNote: `refund ${input.mode}: ${input.reason}`,
        })
        .where(eq(payments.id, id));
      await recordPaymentEvent(tx, {
        paymentId: id,
        bookingId: locked.bookingId,
        gateway: locked.gateway as PaymentGatewayName,
        action: 'payment.refund_recorded',
        actorType: 'admin',
        actorUserId: admin.id,
        orderId: locked.orderId,
        gatewayPaymentId: locked.gatewayPaymentId,
        metadata: { mode: input.mode, amount: input.amount, reference, full },
      });
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'payment.refund_recorded',
          targetType: 'payment',
          targetId: id,
          reason: input.reason,
          ip: meta.ip ?? null,
          metadata: {
            mode: input.mode,
            amount: input.amount,
            reference,
            bookingId: locked.bookingId,
          },
        },
        tx,
      );
      const ctx = await loadBookingContext(tx, eq(bookings.id, locked.bookingId));
      if (ctx) {
        await this.email.enqueue(
          paymentRefundRecordedEmail({
            ...bookingEmailBase(
              ctx,
              ctx.customer,
              `${this.webAppUrl}/bookings/${locked.bookingId}`,
            ),
            amount: input.amount,
            reason: input.reason,
            refundReference: reference || input.mode,
          }),
          tx,
        );
      }
    });
    this.logger.info({ paymentId: id, adminId: admin.id, mode: input.mode }, 'Refund recorded');
    return this.getForAdmin(id);
  }

  /** Clears the manual-resolution flag without moving money (e.g. a chargeback handled offline). */
  async resolve(
    admin: AuthenticatedUser,
    id: string,
    input: ResolvePaymentRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminPayment & { bookingReference: string }> {
    const current = await this.getRow(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          requiresManualResolution: false,
          resolvedAt: now,
          resolvedBy: admin.id,
          resolutionNote: input.note,
        })
        .where(eq(payments.id, id));
      await recordPaymentEvent(tx, {
        paymentId: id,
        bookingId: current.bookingId,
        gateway: current.gateway as PaymentGatewayName,
        action: 'payment.resolved',
        actorType: 'admin',
        actorUserId: admin.id,
        orderId: current.orderId,
        metadata: { anomaly: current.anomaly },
      });
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'payment.resolved',
          targetType: 'payment',
          targetId: id,
          reason: input.note,
          ip: meta.ip ?? null,
        },
        tx,
      );
    });
    return this.getForAdmin(id);
  }

  /** Compares our record with the gateway's Retrieval API (503 when not configured). */
  async reconcile(
    admin: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<PaymentReconciliation> {
    const current = await this.getRow(id);
    if (!this.gateway.canRetrieve) {
      throw new ApiException(
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'The gateway Retrieval API is not configured (PAYHERE_APP_ID / PAYHERE_APP_SECRET)',
        503,
      );
    }
    const record = await this.gateway.fetchByOrderId(current.orderId);
    const matches =
      record !== null &&
      record.status === 'RECEIVED' &&
      compareAmounts(record.amount || '0', current.amount) === 0 &&
      record.currency === current.currency &&
      (current.gatewayPaymentId === null || record.gatewayPaymentId === current.gatewayPaymentId);
    await recordPaymentEvent(this.db, {
      paymentId: id,
      bookingId: current.bookingId,
      gateway: current.gateway as PaymentGatewayName,
      action: 'payment.reconciled',
      actorType: 'admin',
      actorUserId: admin.id,
      orderId: current.orderId,
      gatewayPaymentId: record?.gatewayPaymentId ?? null,
      metadata: {
        gatewayStatus: record?.status ?? null,
        gatewayAmount: record?.amount ?? null,
        matches,
        ip: meta.ip ?? null,
      },
    });
    return {
      paymentId: id,
      gateway: this.gateway.name,
      gatewayStatus: record?.status ?? null,
      gatewayPaymentId: record?.gatewayPaymentId ?? null,
      gatewayAmount: record?.amount ?? null,
      gatewayCurrency: record?.currency ?? null,
      matches,
      checkedAt: new Date().toISOString(),
    };
  }

  // ============================================================== helpers

  private async getRow(id: string): Promise<PaymentRow> {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Payment not found', 404);
    return row;
  }

  private async event(
    tx: DatabaseExecutor,
    payment: PaymentRow,
    action: string,
    n: GatewayNotification,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordPaymentEvent(tx, {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      gateway: this.gateway.name,
      action,
      actorType: 'gateway',
      orderId: payment.orderId,
      gatewayPaymentId: n.gatewayPaymentId,
      statusCode: n.statusCode,
      signatureValid: true,
      metadata,
    });
  }

  /** The notification's gateway payment id unless another attempt already owns it. */
  private async freeGatewayPaymentId(
    tx: DatabaseExecutor,
    payment: PaymentRow,
    n: GatewayNotification,
  ): Promise<string | null> {
    if (!n.gatewayPaymentId) return null;
    const [clash] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.gateway, payment.gateway),
          eq(payments.gatewayPaymentId, n.gatewayPaymentId),
          ne(payments.id, payment.id),
        ),
      )
      .limit(1);
    return clash ? null : n.gatewayPaymentId;
  }

  private async notifyOperator(
    tx: DatabaseExecutor,
    booking: BookingRow,
    payment: PaymentRow,
    anomaly: PaymentAnomaly,
    n: GatewayNotification,
  ): Promise<void> {
    if (!this.operatorEmail) return;
    await this.email.enqueue(
      paymentAnomalyOperatorEmail({
        to: this.operatorEmail,
        reference: booking.reference,
        paymentId: payment.id,
        orderId: payment.orderId,
        anomaly,
        amount: payment.amount,
        currency: payment.currency,
        detail: `Gateway reported ${n.currency} ${n.amount} with status ${n.statusCode}; booking is ${booking.status}.`,
        link: `${this.webAppUrl}/admin/bookings/${booking.id}`,
      }),
      tx,
    );
  }

  /** `ADV-<reference body>-<4 chars>`; pre-checked so a collision never aborts the transaction. */
  private async uniqueOrderId(tx: DatabaseExecutor, reference: string): Promise<string> {
    const body = reference.replace(/^SLR-/, '');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      let suffix = '';
      for (let i = 0; i < 4; i += 1) suffix += ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)];
      const candidate = `ADV-${body}-${suffix}`;
      const [taken] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.orderId, candidate))
        .limit(1);
      if (!taken) return candidate;
    }
    throw new Error('Could not allocate a unique payment order id');
  }
}

export type { BookingContext };
