import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { bookings, reviews, type Database } from '@vrp/database';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../../config/env.schema';
import { DATABASE } from '../../../database/database.module';
import { BookingSettingsService } from '../../bookings/booking-settings.service';
import {
  bookingEmailBase,
  loadBookingContext,
  lockBooking,
  vehicleTitleOf,
} from '../../bookings/booking.persistence';
import { formatColombo } from '../email/booking-templates';
import { EmailService } from '../email/email.service';
import {
  paymentReminderEmail,
  pickupReminderCustomerEmail,
  pickupReminderProviderEmail,
  reviewReminderEmail,
} from '../email/reminder-templates';
import { NotificationsService } from '../inapp/notifications.service';

export interface ReminderSweepResult {
  paymentReminders: number;
  pickupReminders: number;
  reviewReminders: number;
}

const SWEEP_BATCH = 200;
const DAY_SECONDS = 86_400;

/**
 * Reminder sweep (Phase 8, TECH_DECISIONS D58), driven by the worker's
 * `reminders.sweep` schedule and by tests with an explicit `now`. Each
 * reminder is sent at most once per booking (and per recipient): the in-app
 * notification is inserted first with a unique dedupe key inside a
 * transaction, and the e-mail job is enqueued in the same transaction only
 * when that insert happened. A retried or overlapping run therefore cannot
 * duplicate a row or an e-mail; candidates are also filtered in SQL by the
 * same key so steady-state sweeps are one cheap query per reminder type.
 */
@Injectable()
export class RemindersService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: BookingSettingsService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RemindersService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async sendDue(now: Date = new Date()): Promise<ReminderSweepResult> {
    const result: ReminderSweepResult = {
      paymentReminders: 0,
      pickupReminders: 0,
      reviewReminders: 0,
    };
    const settings = await this.settings.get();
    const nowIso = now.toISOString();

    const paymentDue = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'accepted'),
          isNotNull(bookings.confirmBy),
          sql`${bookings.confirmBy} > ${nowIso}::timestamptz`,
          sql`${bookings.confirmBy} - make_interval(secs => ${settings.paymentReminderHoursBefore * 3600}) <= ${nowIso}::timestamptz`,
          this.noNotification(sql`'booking:' || ${bookings.id}::text || ':payment-reminder'`),
        ),
      )
      .orderBy(asc(bookings.confirmBy))
      .limit(SWEEP_BATCH);
    for (const { id } of paymentDue) {
      if (await this.sendPaymentReminder(id, now)) result.paymentReminders += 1;
    }

    const pickupDue = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          sql`${bookings.startsAt} > ${nowIso}::timestamptz`,
          sql`${bookings.startsAt} - make_interval(secs => ${settings.pickupReminderHoursBefore * 3600}) <= ${nowIso}::timestamptz`,
          this.noNotification(
            sql`'booking:' || ${bookings.id}::text || ':pickup-reminder:customer'`,
          ),
        ),
      )
      .orderBy(asc(bookings.startsAt))
      .limit(SWEEP_BATCH);
    for (const { id } of pickupDue) {
      if (await this.sendPickupReminder(id, now)) result.pickupReminders += 1;
    }

    const reviewDue = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'completed'),
          isNotNull(bookings.completedAt),
          sql`${bookings.completedAt} + make_interval(secs => ${settings.reviewReminderDaysAfter * DAY_SECONDS}) <= ${nowIso}::timestamptz`,
          sql`${bookings.completedAt} + make_interval(secs => ${settings.reviewWindowDays * DAY_SECONDS}) > ${nowIso}::timestamptz`,
          sql`not exists (select 1 from ${reviews} r where r.booking_id = ${bookings.id})`,
          this.noNotification(sql`'booking:' || ${bookings.id}::text || ':review-reminder'`),
        ),
      )
      .orderBy(asc(bookings.completedAt))
      .limit(SWEEP_BATCH);
    for (const { id } of reviewDue) {
      if (await this.sendReviewReminder(id, now)) result.reviewReminders += 1;
    }

    if (result.paymentReminders + result.pickupReminders + result.reviewReminders > 0) {
      this.logger.info(result, 'Reminders sent');
    }
    return result;
  }

  /** One payment reminder per accepted, unpaid booking before `confirm_by`. */
  async sendPaymentReminder(id: string, now: Date = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const current = await lockBooking(tx, id);
      if (
        !current ||
        current.status !== 'accepted' ||
        !current.confirmBy ||
        current.confirmBy <= now
      ) {
        return false;
      }
      const ctx = await loadBookingContext(tx, eq(bookings.id, id));
      if (!ctx) return false;
      const created = await this.notifications.create(tx, {
        userId: ctx.customer.id,
        type: 'payment.reminder',
        title: `Pay the advance for ${ctx.booking.reference} by ${formatColombo(current.confirmBy)}`,
        body: `${ctx.provider.displayName} is holding ${vehicleTitleOf(ctx.vehicle)} for you. Pay the advance before the deadline or the reservation is released.`,
        linkPath: `/bookings/${id}`,
        metadata: { bookingId: id },
        dedupeKey: `booking:${id}:payment-reminder`,
      });
      if (!created) return false;
      await this.email.enqueue(
        paymentReminderEmail({
          ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/bookings/${id}`),
          providerName: ctx.provider.displayName,
          advance: ctx.booking.advanceAmount,
          confirmBy: current.confirmBy,
        }),
        tx,
      );
      return true;
    });
  }

  /** One pickup reminder per confirmed booking, to the customer and to the provider. */
  async sendPickupReminder(id: string, now: Date = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const current = await lockBooking(tx, id);
      if (!current || current.status !== 'confirmed' || current.startsAt <= now) return false;
      const ctx = await loadBookingContext(tx, eq(bookings.id, id));
      if (!ctx) return false;
      const when = formatColombo(current.startsAt);
      const title = vehicleTitleOf(ctx.vehicle);
      const toCustomer = await this.notifications.create(tx, {
        userId: ctx.customer.id,
        type: 'pickup.reminder',
        title: `Pickup of ${title} on ${when}`,
        body: `Booking ${ctx.booking.reference}: bring the driver's licence; the rental balance and the refundable deposit are paid to the provider at pickup.`,
        linkPath: `/bookings/${id}`,
        metadata: { bookingId: id },
        dedupeKey: `booking:${id}:pickup-reminder:customer`,
      });
      if (toCustomer) {
        await this.email.enqueue(
          pickupReminderCustomerEmail({
            ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/bookings/${id}`),
            providerName: ctx.provider.displayName,
            pickupAddress: ctx.location.addressText,
            pickupInstructions: ctx.location.pickupInstructions,
            balanceDue: ctx.booking.balanceDueAmount,
            securityDeposit: ctx.booking.securityDepositAmount,
          }),
          tx,
        );
      }
      const toProvider = await this.notifications.create(tx, {
        userId: ctx.owner.id,
        type: 'pickup.reminder',
        title: `Handover of ${title} on ${when}`,
        body: `Booking ${ctx.booking.reference}: check the licence, collect the balance and deposit, and record the pickup.`,
        linkPath: `/provider/bookings/${id}`,
        metadata: { bookingId: id },
        dedupeKey: `booking:${id}:pickup-reminder:provider`,
      });
      if (toProvider) {
        await this.email.enqueue(
          pickupReminderProviderEmail({
            ...bookingEmailBase(ctx, ctx.owner, `${this.webAppUrl}/provider/bookings/${id}`),
            customerName: ctx.customer.fullName,
          }),
          tx,
        );
      }
      return toCustomer !== null || toProvider !== null;
    });
  }

  /** One review reminder per completed booking without a review, while the window is open. */
  async sendReviewReminder(id: string, now: Date = new Date()): Promise<boolean> {
    const settings = await this.settings.get();
    return this.db.transaction(async (tx) => {
      const current = await lockBooking(tx, id);
      if (!current || current.status !== 'completed' || !current.completedAt) return false;
      const closesAt = new Date(
        current.completedAt.getTime() + settings.reviewWindowDays * DAY_SECONDS * 1000,
      );
      if (closesAt <= now) return false;
      const [existing] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.bookingId, id))
        .limit(1);
      if (existing) return false;
      const ctx = await loadBookingContext(tx, eq(bookings.id, id));
      if (!ctx) return false;
      const created = await this.notifications.create(tx, {
        userId: ctx.customer.id,
        type: 'review.reminder',
        title: `How was ${vehicleTitleOf(ctx.vehicle)}?`,
        body: `Leave a short review of booking ${ctx.booking.reference} before ${formatColombo(closesAt)}.`,
        linkPath: `/bookings/${id}/review`,
        metadata: { bookingId: id },
        dedupeKey: `booking:${id}:review-reminder`,
      });
      if (!created) return false;
      await this.email.enqueue(
        reviewReminderEmail({
          ...bookingEmailBase(ctx, ctx.customer, `${this.webAppUrl}/bookings/${id}/review`),
          providerName: ctx.provider.displayName,
          windowClosesAt: closesAt,
        }),
        tx,
      );
      return true;
    });
  }

  private noNotification(keyExpr: ReturnType<typeof sql>) {
    return sql`not exists (select 1 from notifications n where n.dedupe_key = ${keyExpr})`;
  }
}
