import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { bookings, type Database, type DatabaseExecutor } from '@vrp/database';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import {
  bookingAcceptanceExpiredEmail,
  bookingRequestExpiredEmail,
} from '../notifications/email/booking-templates';
import { EmailService } from '../notifications/email/email.service';
import { cancelPendingPayments } from '../payments/payment.persistence';
import {
  bookingEmailBase,
  loadBookingContext,
  lockBooking,
  recordBookingEvent,
  releaseBookingHold,
} from './booking.persistence';
import { BOOKING_TRANSITIONS } from './booking.state';

export interface ExpirySweepResult {
  requestsExpired: number;
  acceptancesExpired: number;
}

const SWEEP_BATCH = 200;

/**
 * Booking timers (USER_FLOWS §0): a `requested` booking expires at
 * `respond_by`; an `accepted` one expires at `confirm_by` and releases its
 * hold. Driven by the worker's scheduled job every minute and also invoked
 * lazily when a provider acts on an overdue request. Every step is a
 * status-conditioned update, so running it twice (or concurrently) is safe.
 * `now` is a parameter so tests control time without sleeping.
 */
@Injectable()
export class BookingExpiryService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BookingExpiryService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async expireDue(now: Date = new Date()): Promise<ExpirySweepResult> {
    const result: ExpirySweepResult = { requestsExpired: 0, acceptancesExpired: 0 };

    const dueRequests = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, 'requested'), lte(bookings.respondBy, now)))
      .orderBy(asc(bookings.respondBy))
      .limit(SWEEP_BATCH);
    for (const { id } of dueRequests) {
      if (await this.expireRequest(id, now)) result.requestsExpired += 1;
    }

    const dueAcceptances = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'accepted'),
          isNotNull(bookings.confirmBy),
          lte(bookings.confirmBy, now),
        ),
      )
      .orderBy(asc(bookings.confirmBy))
      .limit(SWEEP_BATCH);
    for (const { id } of dueAcceptances) {
      if (await this.expireAcceptance(id, now)) result.acceptancesExpired += 1;
    }

    if (result.requestsExpired > 0 || result.acceptancesExpired > 0) {
      this.logger.info(result, 'Expired overdue bookings');
    }
    return result;
  }

  /** `requested → expired` when `respond_by` has passed; false when nothing was due. */
  async expireRequest(id: string, now: Date = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const current = await lockBooking(tx, id);
      if (!current || current.status !== 'requested' || current.respondBy > now) return false;
      await this.markExpired(tx, id, current.version, 'expire_request', now);
      const ctx = await loadBookingContext(tx, eq(bookings.id, id));
      if (ctx) {
        await this.email.enqueue(
          bookingRequestExpiredEmail({
            ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/search`),
            providerName: ctx.provider.displayName,
          }),
          tx,
        );
      }
      return true;
    });
  }

  /** `accepted → expired` when `confirm_by` has passed; releases the hold. */
  async expireAcceptance(id: string, now: Date = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const current = await lockBooking(tx, id);
      if (
        !current ||
        current.status !== 'accepted' ||
        current.confirmBy === null ||
        current.confirmBy > now
      ) {
        return false;
      }
      const released = await releaseBookingHold(tx, id);
      // An open checkout can no longer confirm this booking; a late success is handled as an anomaly.
      const cancelledPayments = await cancelPendingPayments(tx, id, 'booking_expired', now);
      await this.markExpired(tx, id, current.version, 'expire_acceptance', now, {
        holdReleased: released !== undefined,
        pendingPaymentsCancelled: cancelledPayments.length,
      });
      const ctx = await loadBookingContext(tx, eq(bookings.id, id));
      if (ctx) {
        await this.email.enqueue(
          bookingAcceptanceExpiredEmail({
            ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/bookings/${id}`),
            party: 'customer',
          }),
          tx,
        );
        await this.email.enqueue(
          bookingAcceptanceExpiredEmail({
            ...bookingEmailBase(ctx, ctx.owner, `${this.webAppUrl}/provider/bookings/${id}`),
            party: 'provider',
          }),
          tx,
        );
      }
      return true;
    });
  }

  private async markExpired(
    tx: DatabaseExecutor,
    id: string,
    version: number,
    action: 'expire_request' | 'expire_acceptance',
    now: Date,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const { to } = BOOKING_TRANSITIONS[action];
    const from = action === 'expire_request' ? 'requested' : 'accepted';
    const [updated] = await tx
      .update(bookings)
      .set({ status: to, expiredAt: now, version: sql`${bookings.version} + 1` })
      .where(and(eq(bookings.id, id), eq(bookings.version, version), eq(bookings.status, from)))
      .returning({ id: bookings.id });
    if (!updated) throw new Error(`Booking ${id} changed while expiring`);
    await recordBookingEvent(tx, {
      bookingId: id,
      actorType: 'system',
      action: 'booking.expired',
      fromStatus: from,
      toStatus: to,
      metadata: { stage: action === 'expire_request' ? 'request' : 'acceptance', ...metadata },
    });
  }
}
