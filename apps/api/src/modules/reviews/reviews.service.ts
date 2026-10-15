import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  reviewerDisplayName,
  type AdminReview,
  type AdminReviewList,
  type AdminReviewListQuery,
  type BookingReviewState,
  type CreateReviewRequest,
  type CustomerReview,
  type HideReviewRequest,
  type ProviderReview,
  type ProviderReviewList,
  type PublicReviewList,
  type ReplyReviewRequest,
  type ReviewListQuery,
  type UnhideReviewRequest,
} from '@vrp/contracts';
import {
  bookings,
  providerProfiles,
  reviews,
  users,
  vehicles,
  type Database,
  type DatabaseExecutor,
  type ProviderProfile,
  type ReviewRow,
} from '@vrp/database';
import { and, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { BookingSettingsService } from '../bookings/booking-settings.service';
import {
  loadBookingContext,
  lockBooking,
  recordBookingEvent,
  vehicleTitleOf,
  type BookingContext,
} from '../bookings/booking.persistence';
import { EmailService } from '../notifications/email/email.service';
import {
  reviewHiddenCustomerEmail,
  reviewReceivedProviderEmail,
  reviewReplyCustomerEmail,
  reviewUnhiddenCustomerEmail,
} from '../notifications/email/review-templates';
import { NotificationsService } from '../notifications/inapp/notifications.service';
import { ratingSummaryFor } from './rating.aggregates';
import {
  reviewEditability,
  toAdminReview,
  toCustomerReview,
  toProviderReview,
  toPublicReview,
  type ReviewRowSet,
} from './review.mappers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/** End of the review window for a completed booking. */
export function reviewWindowEnd(completedAt: Date, windowDays: number): Date {
  return new Date(completedAt.getTime() + windowDays * DAY_MS);
}

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown })?.code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof cause === 'string' ? cause : undefined;
}

/**
 * Reviews (Phase 8, TECH_DECISIONS D57). Every identity field comes from the
 * booking row locked inside the transaction; the client supplies ratings and
 * a comment only. Rules: own booking, status `completed`, within
 * `review_window_days` of completion, one review per booking (unique index as
 * the final guard). Reviews publish immediately; admins hide / unhide with an
 * audit row; the provider may reply once. Aggregates are computed on read
 * (`rating.aggregates.ts`), so hiding and editing never leave counters stale.
 */
@Injectable()
export class ReviewsService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: BookingSettingsService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReviewsService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ------------------------------------------------------------- customer

  async stateForBooking(
    customer: AuthenticatedUser,
    bookingId: string,
    now = new Date(),
  ): Promise<BookingReviewState> {
    const [found] = await this.db
      .select({ booking: bookings, vehicle: vehicles })
      .from(bookings)
      .innerJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
      .where(and(eq(bookings.id, bookingId), eq(bookings.customerUserId, customer.id)))
      .limit(1);
    if (!found) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    const settings = await this.settings.get();
    const [row] = await this.rows(this.db).where(eq(reviews.bookingId, bookingId)).limit(1);
    const windowClosesAt = found.booking.completedAt
      ? reviewWindowEnd(found.booking.completedAt, settings.reviewWindowDays)
      : null;
    const reason = row
      ? 'already_reviewed'
      : found.booking.status !== 'completed' || !windowClosesAt
        ? 'not_completed'
        : windowClosesAt <= now
          ? 'window_closed'
          : null;
    return {
      bookingId,
      reference: found.booking.reference,
      vehicle: {
        id: found.vehicle.id,
        slug: found.vehicle.slug ?? found.vehicle.id,
        title: vehicleTitleOf(found.vehicle),
      },
      eligible: reason === null,
      reason,
      windowClosesAt: windowClosesAt ? windowClosesAt.toISOString() : null,
      review: row
        ? toCustomerReview(row, reviewEditability(row.review, windowClosesAt, now))
        : null,
    };
  }

  async create(
    customer: AuthenticatedUser,
    bookingId: string,
    input: CreateReviewRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<CustomerReview> {
    const settings = await this.settings.get();
    const reviewId = await this.db.transaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId, { customerUserId: customer.id });
      if (!booking) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      if (booking.status !== 'completed' || !booking.completedAt) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'Only completed bookings can be reviewed',
          409,
        );
      }
      const closesAt = reviewWindowEnd(booking.completedAt, settings.reviewWindowDays);
      if (closesAt <= now) {
        throw new ApiException(
          'REVIEW_WINDOW_CLOSED',
          `Reviews for this booking were possible until ${closesAt.toISOString()}`,
          409,
        );
      }
      const [existing] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.bookingId, bookingId))
        .limit(1);
      if (existing) {
        throw new ApiException('ALREADY_REVIEWED', 'This booking has already been reviewed', 409);
      }
      let inserted: ReviewRow | undefined;
      try {
        [inserted] = await tx
          .insert(reviews)
          .values({
            bookingId,
            customerUserId: booking.customerUserId,
            providerId: booking.providerId,
            vehicleId: booking.vehicleId,
            overallRating: input.overallRating,
            vehicleRating: input.vehicleRating ?? null,
            serviceRating: input.serviceRating ?? null,
            communicationRating: input.communicationRating ?? null,
            comment: input.comment ?? null,
          })
          .returning();
      } catch (error) {
        if (pgErrorCode(error) === '23505') {
          throw new ApiException('ALREADY_REVIEWED', 'This booking has already been reviewed', 409);
        }
        throw error;
      }
      if (!inserted) throw new Error('review insert returned no row');
      await recordBookingEvent(tx, {
        bookingId,
        actorType: 'customer',
        actorUserId: customer.id,
        action: 'booking.reviewed',
        metadata: { overallRating: input.overallRating },
      });
      const ctx = await loadBookingContext(tx, eq(bookings.id, bookingId));
      if (ctx) await this.notifyProviderOfReview(tx, ctx, inserted, input);
      this.logger.info({ bookingId, reviewId: inserted.id, ip: meta.ip ?? null }, 'Review created');
      return inserted.id;
    });
    return this.customerView(customer.id, reviewId, now);
  }

  /**
   * Full replacement of the ratings and comment. Allowed only while the booking
   * is completed, the review window is open, the review is published and the
   * provider has **not** replied: once a reply exists the review is locked
   * (`409 REVIEW_LOCKED_AFTER_REPLY`) so the public reply always refers to the
   * text it answered. The review row is locked `FOR UPDATE` here and in
   * `reply()`, so a concurrent reply and edit serialise: whichever commits
   * first decides, and the guarded UPDATE is the final check.
   */
  async update(
    customer: AuthenticatedUser,
    bookingId: string,
    input: CreateReviewRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<CustomerReview> {
    const settings = await this.settings.get();
    const reviewId = await this.db.transaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId, { customerUserId: customer.id });
      if (!booking) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      if (booking.status !== 'completed' || !booking.completedAt) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'Only completed bookings have an editable review',
          409,
        );
      }
      const [row] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.bookingId, bookingId))
        .for('update');
      if (!row) throw new ApiException('NOT_FOUND', 'No review for this booking yet', 404);
      const closesAt = reviewWindowEnd(booking.completedAt, settings.reviewWindowDays);
      if (closesAt <= now) {
        throw new ApiException(
          'REVIEW_WINDOW_CLOSED',
          `Reviews for this booking could be edited until ${closesAt.toISOString()}`,
          409,
        );
      }
      if (row.status !== 'published') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'A hidden review cannot be edited; contact support',
          409,
        );
      }
      if (row.providerReply !== null) {
        throw new ApiException(
          'REVIEW_LOCKED_AFTER_REPLY',
          'This review can no longer be edited because the provider has replied',
          409,
        );
      }
      // Final guard inside the same statement: a reply that slipped in cannot be overwritten.
      const [updated] = await tx
        .update(reviews)
        .set({
          overallRating: input.overallRating,
          vehicleRating: input.vehicleRating ?? null,
          serviceRating: input.serviceRating ?? null,
          communicationRating: input.communicationRating ?? null,
          comment: input.comment ?? null,
        })
        .where(
          and(
            eq(reviews.id, row.id),
            eq(reviews.status, 'published'),
            isNull(reviews.providerReply),
          ),
        )
        .returning({ id: reviews.id });
      if (!updated) {
        throw new ApiException(
          'REVIEW_LOCKED_AFTER_REPLY',
          'This review can no longer be edited because the provider has replied',
          409,
        );
      }
      this.logger.info({ bookingId, reviewId: row.id, ip: meta.ip ?? null }, 'Review updated');
      return row.id;
    });
    return this.customerView(customer.id, reviewId, now);
  }

  // ------------------------------------------------------------- public

  /** Published reviews of a discoverable (approved) vehicle, newest first, with the aggregate. */
  async listForVehicle(idOrSlug: string, query: ReviewListQuery): Promise<PublicReviewList> {
    const [vehicle] = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        and(
          UUID.test(idOrSlug) ? eq(vehicles.id, idOrSlug) : eq(vehicles.slug, idOrSlug),
          eq(vehicles.status, 'approved'),
        ),
      )
      .limit(1);
    if (!vehicle) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);
    const page = await this.page(
      this.db,
      and(eq(reviews.vehicleId, vehicle.id), eq(reviews.status, 'published')),
      query,
    );
    return {
      data: page.data.map(toPublicReview),
      nextCursor: page.nextCursor,
      summary: await ratingSummaryFor(this.db, 'vehicle_id', vehicle.id),
    };
  }

  // ------------------------------------------------------------- provider

  async listForProvider(providerId: string, query: ReviewListQuery): Promise<ProviderReviewList> {
    const page = await this.page(this.db, eq(reviews.providerId, providerId), query);
    return { data: page.data.map(toProviderReview), nextCursor: page.nextCursor };
  }

  /** One reply per review, only to published reviews of the caller's own vehicles. */
  async reply(
    provider: ProviderProfile,
    reviewId: string,
    input: ReplyReviewRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<ProviderReview> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(reviews)
        .where(and(eq(reviews.id, reviewId), eq(reviews.providerId, provider.id)))
        .for('update');
      if (!row) throw new ApiException('NOT_FOUND', 'Review not found', 404);
      if (row.status !== 'published') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'Only published reviews can be replied to',
          409,
        );
      }
      if (row.providerReply !== null) {
        throw new ApiException('ALREADY_REPLIED', 'This review already has a reply', 409);
      }
      await tx
        .update(reviews)
        .set({ providerReply: input.reply, providerRepliedAt: now })
        .where(eq(reviews.id, row.id));
      const ctx = await loadBookingContext(tx, eq(bookings.id, row.bookingId));
      if (ctx) {
        const title = vehicleTitleOf(ctx.vehicle);
        const link = `/bookings/${row.bookingId}/review`;
        await this.notifications.create(tx, {
          userId: ctx.customer.id,
          type: 'review.replied',
          title: `${ctx.provider.displayName} replied to your review`,
          body: `Your review of ${title} (booking ${ctx.booking.reference}) has a reply from the provider.`,
          linkPath: link,
          metadata: { bookingId: row.bookingId, reviewId: row.id },
          dedupeKey: `review:${row.id}:replied`,
        });
        await this.email.enqueue(
          reviewReplyCustomerEmail({
            to: ctx.customer.email,
            fullName: ctx.customer.fullName,
            reference: ctx.booking.reference,
            vehicleTitle: title,
            link: `${this.webAppUrl}${link}`,
            providerName: ctx.provider.displayName,
            reply: input.reply,
          }),
          tx,
        );
      }
      this.logger.info({ reviewId: row.id, ip: meta.ip ?? null }, 'Review replied');
    });
    const [row] = await this.rows(this.db)
      .where(and(eq(reviews.id, reviewId), eq(reviews.providerId, provider.id)))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Review not found', 404);
    return toProviderReview(row);
  }

  // ------------------------------------------------------------- admin

  async listForAdmin(query: AdminReviewListQuery): Promise<AdminReviewList> {
    const page = await this.page(
      this.db,
      query.status ? eq(reviews.status, query.status) : undefined,
      query,
    );
    return { data: page.data.map(toAdminReview), nextCursor: page.nextCursor };
  }

  async getForAdmin(id: string): Promise<AdminReview> {
    const [row] = await this.rows(this.db).where(eq(reviews.id, id)).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Review not found', 404);
    return toAdminReview(row);
  }

  async hide(
    admin: AuthenticatedUser,
    id: string,
    input: HideReviewRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminReview> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
      if (!row) throw new ApiException('NOT_FOUND', 'Review not found', 404);
      if (row.status !== 'published') {
        throw new ApiException('INVALID_STATE_TRANSITION', 'The review is already hidden', 409);
      }
      await tx
        .update(reviews)
        .set({ status: 'hidden', hiddenAt: now, hiddenBy: admin.id, hiddenReason: input.reason })
        .where(eq(reviews.id, id));
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'review.hidden',
          targetType: 'review',
          targetId: id,
          reason: input.reason,
          metadata: {
            bookingId: row.bookingId,
            vehicleId: row.vehicleId,
            providerId: row.providerId,
          },
          ip: meta.ip ?? null,
        },
        tx,
      );
      const ctx = await loadBookingContext(tx, eq(bookings.id, row.bookingId));
      if (ctx) {
        const title = vehicleTitleOf(ctx.vehicle);
        const link = `/bookings/${row.bookingId}/review`;
        await this.notifications.create(tx, {
          userId: ctx.customer.id,
          type: 'review.hidden',
          title: 'Your review was hidden',
          body: `Our team hid your review of ${title} (booking ${ctx.booking.reference}). Reason: ${input.reason}`,
          linkPath: link,
          metadata: { bookingId: row.bookingId, reviewId: row.id },
          dedupeKey: `review:${row.id}:hidden:${now.getTime()}`,
        });
        await this.email.enqueue(
          reviewHiddenCustomerEmail({
            to: ctx.customer.email,
            fullName: ctx.customer.fullName,
            reference: ctx.booking.reference,
            vehicleTitle: title,
            link: `${this.webAppUrl}${link}`,
            reason: input.reason,
          }),
          tx,
        );
      }
      this.logger.info({ reviewId: id, adminId: admin.id }, 'Review hidden');
    });
    return this.getForAdmin(id);
  }

  async unhide(
    admin: AuthenticatedUser,
    id: string,
    input: UnhideReviewRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminReview> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
      if (!row) throw new ApiException('NOT_FOUND', 'Review not found', 404);
      if (row.status !== 'hidden') {
        throw new ApiException('INVALID_STATE_TRANSITION', 'The review is not hidden', 409);
      }
      await tx
        .update(reviews)
        .set({ status: 'published', hiddenAt: null, hiddenBy: null, hiddenReason: null })
        .where(eq(reviews.id, id));
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'review.unhidden',
          targetType: 'review',
          targetId: id,
          reason: input.note ?? null,
          metadata: {
            bookingId: row.bookingId,
            vehicleId: row.vehicleId,
            providerId: row.providerId,
          },
          ip: meta.ip ?? null,
        },
        tx,
      );
      const ctx = await loadBookingContext(tx, eq(bookings.id, row.bookingId));
      if (ctx) {
        const title = vehicleTitleOf(ctx.vehicle);
        const link = `/bookings/${row.bookingId}/review`;
        await this.notifications.create(tx, {
          userId: ctx.customer.id,
          type: 'review.unhidden',
          title: 'Your review is visible again',
          body: `Your review of ${title} (booking ${ctx.booking.reference}) is shown publicly again.`,
          linkPath: link,
          metadata: { bookingId: row.bookingId, reviewId: row.id },
          dedupeKey: `review:${row.id}:unhidden:${now.getTime()}`,
        });
        await this.email.enqueue(
          reviewUnhiddenCustomerEmail({
            to: ctx.customer.email,
            fullName: ctx.customer.fullName,
            reference: ctx.booking.reference,
            vehicleTitle: title,
            link: `${this.webAppUrl}${link}`,
          }),
          tx,
        );
      }
      this.logger.info({ reviewId: id, adminId: admin.id }, 'Review unhidden');
    });
    return this.getForAdmin(id);
  }

  // ------------------------------------------------------------- internals

  private rows(executor: DatabaseExecutor) {
    return executor
      .select({
        review: reviews,
        customer: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          status: users.status,
        },
        vehicle: vehicles,
        booking: {
          id: bookings.id,
          reference: bookings.reference,
          completedAt: bookings.completedAt,
        },
        provider: { id: providerProfiles.id, displayName: providerProfiles.displayName },
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.customerUserId))
      .innerJoin(vehicles, eq(vehicles.id, reviews.vehicleId))
      .innerJoin(bookings, eq(bookings.id, reviews.bookingId))
      .innerJoin(providerProfiles, eq(providerProfiles.id, reviews.providerId))
      .$dynamic();
  }

  /** Keyset page over `(created_at desc, id desc)`. */
  private async page(
    executor: DatabaseExecutor,
    where: SQL | undefined,
    query: { cursor?: string; limit: number },
  ): Promise<{ data: ReviewRowSet[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.rows(executor)
      .where(
        and(
          where,
          cursor
            ? or(
                lt(reviews.createdAt, cursor.createdAt),
                and(eq(reviews.createdAt, cursor.createdAt), lt(reviews.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(query.limit + 1);
    const page = paginate(
      rows.map((row) => ({ ...row, createdAt: row.review.createdAt, id: row.review.id })),
      query.limit,
    );
    return { data: page.data, nextCursor: page.nextCursor };
  }

  private editableUntil(review: ReviewRow, windowClosesAt: Date | null, now: Date): Date | null {
    return review.status === 'published' && windowClosesAt && windowClosesAt > now
      ? windowClosesAt
      : null;
  }

  private async customerView(
    customerId: string,
    reviewId: string,
    now: Date,
  ): Promise<CustomerReview> {
    const settings = await this.settings.get();
    const [row] = await this.rows(this.db)
      .where(and(eq(reviews.id, reviewId), eq(reviews.customerUserId, customerId)))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Review not found', 404);
    const windowClosesAt = row.booking.completedAt
      ? reviewWindowEnd(row.booking.completedAt, settings.reviewWindowDays)
      : null;
    return toCustomerReview(row, reviewEditability(row.review, windowClosesAt, now));
  }

  private async notifyProviderOfReview(
    tx: DatabaseExecutor,
    ctx: BookingContext,
    review: ReviewRow,
    input: CreateReviewRequest,
  ): Promise<void> {
    const title = vehicleTitleOf(ctx.vehicle);
    const reviewer = reviewerDisplayName(ctx.customer.fullName);
    await this.notifications.create(tx, {
      userId: ctx.owner.id,
      type: 'review.received',
      title: `New review for ${title}`,
      body: `${reviewer} rated booking ${ctx.booking.reference} ${input.overallRating} out of 5.`,
      linkPath: '/provider/reviews',
      metadata: { bookingId: ctx.booking.id, reviewId: review.id },
      dedupeKey: `review:${review.id}:received`,
    });
    await this.email.enqueue(
      reviewReceivedProviderEmail({
        to: ctx.owner.email,
        fullName: ctx.owner.fullName,
        reference: ctx.booking.reference,
        vehicleTitle: title,
        link: `${this.webAppUrl}/provider/reviews`,
        reviewerName: reviewer,
        overallRating: input.overallRating,
        comment: input.comment ?? null,
      }),
      tx,
    );
  }
}
