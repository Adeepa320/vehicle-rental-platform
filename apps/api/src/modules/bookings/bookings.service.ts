import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BOOKING_PRICE_NOTE,
  DECLINE_REASON_LABEL,
  MAX_BOOKING_HORIZON_DAYS,
  MIN_BOOKING_LEAD_HOURS,
  compareAmounts,
  computeBookingPrice,
  formatLkr,
  rentalDays,
  type AcceptBookingRequest,
  type AdminBooking,
  type AdminBookingListQuery,
  type Booking as BookingView,
  type BookingContact,
  type BookingList,
  type BookingListQuery,
  type BookingQuote,
  type BookingQuoteQuery,
  type BookingViewer,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type DeclineBookingRequest,
  type HandoverRequest,
  type NoShowBookingRequest,
  type ProviderBookingListQuery,
  type QuoteUnavailableReason,
  OPEN_BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
} from '@vrp/contracts';
import {
  bookingDrivers,
  bookingIdempotencyKeys,
  bookings,
  providerLocations,
  providerProfiles,
  vehicleCategories,
  vehicleHolds,
  vehicles,
  type Booking as BookingRow,
  type BookingStatus as DbBookingStatus,
  type Database,
  type DatabaseExecutor,
  type NewBooking,
  type ProviderLocation,
  type ProviderProfile,
  type Vehicle,
} from '@vrp/database';
import { and, desc, eq, gt, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { isDeadlock, isExclusionViolation } from '../catalogue/catalogue.helpers';
import { VehiclePhotosService } from '../catalogue/vehicle-photos.service';
import { toPublicPricing } from '../discovery/public.mappers';
import { searchableCondition } from '../discovery/searchable';
import { toAdminPayment } from '../payments/payment.mappers';
import {
  loadPaymentEventsFor,
  loadPaymentsForBookings,
  settlePaymentsOnCancellation,
} from '../payments/payment.persistence';
import { paymentCancellationRefundEmail } from '../notifications/email/payment-templates';
import {
  bookingAcceptedEmail,
  bookingCancelledEmail,
  bookingCompletedEmail,
  bookingConfirmedCustomerEmail,
  bookingConfirmedProviderEmail,
  bookingDeclinedEmail,
  bookingNoShowEmail,
  bookingPickedUpEmail,
  bookingRequestReceivedEmail,
  bookingRequestedProviderEmail,
} from '../notifications/email/booking-templates';
import { APP_NAME } from '../notifications/email/templates';
import { EmailService } from '../notifications/email/email.service';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingQuoteService } from './booking-quote.service';
import { BookingSettingsService } from './booking-settings.service';
import {
  toAdminBookingView,
  toBookingSummary,
  toBookingView,
  type ViewContext,
} from './booking.mappers';
import {
  bookingEmailBase,
  firstName,
  holdOfBooking,
  listBookingEvents,
  loadBookingContext,
  loadBookingContexts,
  lockBooking,
  overlappingHolds,
  recordBookingEvent,
  releaseBookingHold,
  type BookingContext,
} from './booking.persistence';
import { generateBookingReference } from './booking-reference';
import {
  BOOKING_TRANSITIONS,
  holdsVehicle,
  noShowAllowedAt,
  contactAvailable,
  type BookingTransitionAction,
} from './booking.state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface BookableVehicle {
  vehicle: Vehicle;
  provider: ProviderProfile;
  location: ProviderLocation;
}

export interface CreateBookingResult {
  booking: BookingView;
  /** True when an earlier request with the same `Idempotency-Key` was returned. */
  replayed: boolean;
}

/**
 * Lean booking lifecycle (TECH_DECISIONS D48–D52). Invariants:
 * - a `requested` booking never blocks the vehicle; several customers may
 *   request the same period;
 * - the exclusive `vehicle_holds` row is written only by `accept`, inside one
 *   transaction that locks the booking and the vehicle row, re-checks
 *   availability and lets the exclusion constraint be the final guard;
 * - every transition is `UPDATE … WHERE status IN (from) AND version = $v`
 *   (`409 STALE_VERSION` otherwise) and writes a `booking_events` row plus
 *   its e-mails in the same transaction;
 * - prices are snapshotted at request time and never recomputed.
 */
@Injectable()
export class BookingsService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quotes: BookingQuoteService,
    private readonly settings: BookingSettingsService,
    private readonly expiry: BookingExpiryService,
    private readonly photos: VehiclePhotosService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BookingsService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ================================================================ quote

  async quote(idOrSlug: string, query: BookingQuoteQuery, now = new Date()): Promise<BookingQuote> {
    const row = await this.loadBookable(this.db, idOrSlug);
    if (!row) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);
    const startsAt = new Date(query.startsAt);
    const endsAt = new Date(query.endsAt);
    const days = rentalDays(startsAt, endsAt);
    const settings = await this.settings.get();
    const price = computeBookingPrice(
      toPublicPricing(row.vehicle),
      days,
      settings.advancePercentage,
    );
    const reasons = this.ruleViolations(row.vehicle, startsAt, days, now);
    const conflicts = await overlappingHolds(this.db, row.vehicle.id, startsAt, endsAt);
    if (conflicts.length > 0) reasons.push('date_conflict');
    const bookable = reasons.length === 0;
    const issued = bookable
      ? this.quotes.issue({
          vehicleId: row.vehicle.id,
          startsAt,
          endsAt,
          price,
          fingerprint: this.quotes.fingerprint(row.vehicle),
          now,
        })
      : null;
    return {
      vehicleId: row.vehicle.id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      available: conflicts.length === 0,
      bookable,
      reasons,
      price,
      quoteToken: issued?.token ?? null,
      expiresAt: issued?.expiresAt.toISOString() ?? null,
      note: BOOKING_PRICE_NOTE,
    };
  }

  // =============================================================== create

  async create(
    customer: AuthenticatedUser,
    input: CreateBookingRequest,
    idempotencyKey: string,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<CreateBookingResult> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const requestHash = this.requestHash(customer.id, input, startsAt, endsAt);
    const payload = this.quotes.verify(input.quoteToken, now);
    if (
      payload.vid !== input.vehicleId ||
      payload.s !== startsAt.toISOString() ||
      payload.e !== endsAt.toISOString()
    ) {
      throw new ApiException(
        'QUOTE_CHANGED',
        'The quote does not match this vehicle and period; refresh the price and try again',
        409,
      );
    }

    type Outcome = { replayedId: string } | { createdId: string };
    const outcome = await this.db.transaction(async (tx): Promise<Outcome> => {
      // 1. Claim the idempotency key first; a concurrent duplicate waits here until we commit.
      const claimed = await tx
        .insert(bookingIdempotencyKeys)
        .values({ customerUserId: customer.id, key: idempotencyKey, requestHash })
        .onConflictDoNothing()
        .returning({ key: bookingIdempotencyKeys.key });
      if (claimed.length === 0) {
        const [existing] = await tx
          .select()
          .from(bookingIdempotencyKeys)
          .where(
            and(
              eq(bookingIdempotencyKeys.customerUserId, customer.id),
              eq(bookingIdempotencyKeys.key, idempotencyKey),
            ),
          );
        if (!existing || existing.requestHash !== requestHash || !existing.bookingId) {
          throw new ApiException(
            'IDEMPOTENCY_CONFLICT',
            'This Idempotency-Key was already used for a different request',
            409,
          );
        }
        return { replayedId: existing.bookingId };
      }

      // 2. Vehicle must be publicly bookable right now (approved, active provider/location/category, photos).
      const row = await this.loadBookable(tx, input.vehicleId);
      if (!row) throw new ApiException('NOT_FOUND', 'Vehicle not found or not bookable', 404);
      if (row.provider.userId === customer.id) {
        throw new ApiException('FORBIDDEN', 'You cannot book your own vehicle', 403);
      }

      // 3. Period rules and the server-side price; the client's quote must still match.
      const days = rentalDays(startsAt, endsAt);
      const violations = this.ruleViolations(row.vehicle, startsAt, days, now);
      if (violations.length > 0) {
        throw new ApiException(
          'VALIDATION_ERROR',
          'Invalid request body',
          400,
          violations.map((reason) => ({
            field:
              reason === 'outside_min_days' || reason === 'outside_max_days'
                ? 'endsAt'
                : 'startsAt',
            issue: RULE_MESSAGES[reason],
          })),
        );
      }
      const settings = await this.settings.get();
      const price = computeBookingPrice(
        toPublicPricing(row.vehicle),
        days,
        settings.advancePercentage,
      );
      const fingerprint = this.quotes.fingerprint(row.vehicle);
      if (
        payload.sub !== price.subtotal ||
        payload.dep !== price.securityDeposit ||
        payload.fp !== fingerprint
      ) {
        throw new ApiException(
          'QUOTE_CHANGED',
          'The price changed since you were quoted; refresh the price and try again',
          409,
        );
      }

      // 4. Existing holds (accepted bookings, manual blocks) refuse the request; other requests do not.
      const conflicts = await overlappingHolds(tx, row.vehicle.id, startsAt, endsAt);
      if (conflicts.length > 0) {
        throw new ApiException(
          'BOOKING_CONFLICT',
          'The vehicle is no longer available for these dates',
          409,
        );
      }

      // 5. Insert the request (no hold), its driver snapshot and the first event.
      const respondBy = new Date(
        Math.min(now.getTime() + settings.providerResponseHours * HOUR_MS, startsAt.getTime()),
      );
      const reference = await this.uniqueReference(tx);
      const [created] = await tx
        .insert(bookings)
        .values({
          reference,
          customerUserId: customer.id,
          providerId: row.provider.id,
          vehicleId: row.vehicle.id,
          locationId: row.location.id,
          status: 'requested',
          startsAt,
          endsAt,
          rentalDays: days,
          customerNote: input.customerNote ?? null,
          currency: price.currency,
          priceBasis: price.basis,
          dailyRate: price.dailyRate,
          weeklyRate: price.weeklyRate,
          monthlyRate: price.monthlyRate,
          subtotalAmount: price.subtotal,
          securityDepositAmount: price.securityDeposit,
          includedKmPerDay: price.includedKmPerDay,
          extraKmRate: price.extraKmRate,
          priceBreakdown: price.lines,
          pricingFingerprint: fingerprint,
          advancePercentage: price.advancePercentage,
          advanceAmount: price.advance,
          balanceDueAmount: price.balanceDue,
          respondBy,
        })
        .returning();
      if (!created) throw new Error('Failed to create booking');
      await tx.insert(bookingDrivers).values({
        bookingId: created.id,
        fullName: input.driver.fullName,
        countryCode: input.driver.countryCode ?? null,
        licenceCountry: input.driver.licenceCountry,
        licenceExpiresOn: input.driver.licenceExpiresOn,
      });
      await tx
        .update(bookingIdempotencyKeys)
        .set({ bookingId: created.id })
        .where(
          and(
            eq(bookingIdempotencyKeys.customerUserId, customer.id),
            eq(bookingIdempotencyKeys.key, idempotencyKey),
          ),
        );
      await recordBookingEvent(tx, {
        bookingId: created.id,
        actorType: 'customer',
        actorUserId: customer.id,
        action: 'booking.requested',
        fromStatus: null,
        toStatus: 'requested',
        metadata: { rentalDays: days, respondBy: respondBy.toISOString() },
      });

      // 6. Notify both parties in the same transaction.
      const ctx = await this.contextOrThrow(tx, created.id);
      await this.email.enqueue(
        bookingRequestedProviderEmail({
          ...bookingEmailBase(ctx, ctx.owner, this.providerLink(ctx.booking.id)),
          customerFirstName: firstName(ctx.customer.fullName),
          respondBy,
          customerNote: ctx.booking.customerNote,
        }),
        tx,
      );
      await this.email.enqueue(
        bookingRequestReceivedEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(ctx.booking.id)),
          providerName: ctx.provider.displayName,
          respondBy,
        }),
        tx,
      );
      this.logger.info(
        { bookingId: created.id, vehicleId: row.vehicle.id, ip: meta.ip },
        'Booking requested',
      );
      return { createdId: created.id };
    });

    const id = 'replayedId' in outcome ? outcome.replayedId : outcome.createdId;
    return { booking: await this.viewFor(id, 'customer'), replayed: 'replayedId' in outcome };
  }

  // ================================================================ reads

  async listForCustomer(userId: string, query: BookingListQuery): Promise<BookingList> {
    return this.list(
      'customer',
      and(eq(bookings.customerUserId, userId), this.statusFilter(query.status, query.scope)),
      query,
    );
  }

  async listForProvider(providerId: string, query: ProviderBookingListQuery): Promise<BookingList> {
    return this.list(
      'provider',
      and(
        eq(bookings.providerId, providerId),
        query.vehicleId ? eq(bookings.vehicleId, query.vehicleId) : undefined,
        this.statusFilter(query.status, query.scope),
      ),
      query,
    );
  }

  async listForAdmin(query: AdminBookingListQuery): Promise<BookingList> {
    return this.list(
      'admin',
      and(
        query.status ? eq(bookings.status, query.status) : undefined,
        query.providerId ? eq(bookings.providerId, query.providerId) : undefined,
        query.customerId ? eq(bookings.customerUserId, query.customerId) : undefined,
        query.reference ? eq(bookings.reference, query.reference.toUpperCase()) : undefined,
      ),
      query,
    );
  }

  /** Detail for either participant; anyone else gets 404 (ids are not enumerable). */
  async getForParticipant(id: string, user: AuthenticatedUser): Promise<BookingView> {
    const ctx = await loadBookingContext(this.db, eq(bookings.id, id));
    const viewer = ctx ? this.participantRole(ctx, user) : null;
    if (!ctx || !viewer) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    return this.render(ctx, viewer);
  }

  async getForProvider(providerId: string, id: string): Promise<BookingView> {
    const ctx = await loadBookingContext(
      this.db,
      and(eq(bookings.id, id), eq(bookings.providerId, providerId)),
    );
    if (!ctx) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    return this.render(ctx, 'provider');
  }

  async getForAdmin(id: string): Promise<AdminBooking> {
    const ctx = await loadBookingContext(this.db, eq(bookings.id, id));
    if (!ctx) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    const [events, hold, view] = await Promise.all([
      listBookingEvents(this.db, id),
      holdOfBooking(this.db, id),
      this.viewContext(ctx, 'admin'),
    ]);
    const eventsByPayment = await loadPaymentEventsFor(
      this.db,
      view.payments.map((p) => p.id),
    );
    return toAdminBookingView(
      ctx,
      view,
      events,
      hold ?? null,
      view.payments.map((p) => toAdminPayment(p, eventsByPayment.get(p.id) ?? [])),
    );
  }

  /**
   * Counterparty contact details from the reveal stage on (SECURITY §3.2);
   * every reveal is written to the booking timeline.
   */
  async contact(id: string, user: AuthenticatedUser): Promise<BookingContact> {
    const ctx = await loadBookingContext(this.db, eq(bookings.id, id));
    const viewer = ctx ? this.participantRole(ctx, user) : null;
    if (!ctx || !viewer) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    const settings = await this.settings.get();
    if (!contactAvailable(ctx.booking.status, settings.contactRevealStage)) {
      throw new ApiException(
        'CONTACT_NOT_AVAILABLE_YET',
        `Contact details are shared once the booking is ${settings.contactRevealStage}`,
        403,
      );
    }
    const party = viewer === 'customer' ? 'provider' : 'customer';
    await this.db.transaction((tx) =>
      recordBookingEvent(tx, {
        bookingId: id,
        actorType: viewer,
        actorUserId: user.id,
        action: 'booking.contact_revealed',
        metadata: { party },
      }),
    );
    const message = `Hello, about booking ${ctx.booking.reference} on ${APP_NAME}`;
    if (party === 'provider') {
      const number = ctx.provider.whatsappE164 ?? ctx.provider.phoneE164;
      return {
        party,
        name: ctx.provider.contactName,
        email: ctx.owner.email,
        phone: ctx.provider.phoneE164,
        whatsappUrl: whatsappLink(number, message),
      };
    }
    return {
      party,
      name: ctx.customer.fullName,
      email: ctx.customer.email,
      phone: ctx.customer.phoneE164,
      whatsappUrl: ctx.customer.phoneE164 ? whatsappLink(ctx.customer.phoneE164, message) : null,
    };
  }

  // ======================================================= provider actions

  /**
   * The critical transaction (DATABASE_DESIGN §7.3): lock the vehicle, then the
   * booking, re-check availability, insert the hold, transition, auto-decline
   * overlapping requests, notify. Concurrent accepts for the same vehicle
   * serialise on the vehicle row, which is always taken first so that two
   * accepts can never wait on each other's booking rows (no deadlock); the
   * exclusion constraint catches anything that slips past.
   */
  async accept(
    provider: ProviderProfile,
    id: string,
    input: AcceptBookingRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    await this.expireIfOverdue(provider.id, id, now);
    await this.db.transaction(async (tx) => {
      const [peek] = await tx
        .select({ vehicleId: bookings.vehicleId })
        .from(bookings)
        .where(and(eq(bookings.id, id), eq(bookings.providerId, provider.id)))
        .limit(1);
      if (!peek) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      const [vehicle] = await tx
        .select({ id: vehicles.id, status: vehicles.status })
        .from(vehicles)
        .where(eq(vehicles.id, peek.vehicleId))
        .for('update');

      const current = await this.lockOwn(tx, id, { providerId: provider.id });
      this.assertVersion(current, input.version);
      this.assertCanTransition(current, 'accept');
      if (!vehicle || vehicle.status !== 'approved') {
        throw new ApiException(
          'BOOKING_CONFLICT',
          'The vehicle is not available for bookings any more',
          409,
        );
      }
      const conflicts = await overlappingHolds(
        tx,
        current.vehicleId,
        current.startsAt,
        current.endsAt,
      );
      if (conflicts.length > 0) throw this.bookingConflict(conflicts.length);

      let holdId: string;
      try {
        const [hold] = await tx
          .insert(vehicleHolds)
          .values({
            vehicleId: current.vehicleId,
            startsAt: current.startsAt,
            endsAt: current.endsAt,
            kind: 'booking',
            bookingId: current.id,
            createdBy: provider.userId,
          })
          .returning({ id: vehicleHolds.id });
        if (!hold) throw new Error('Failed to create booking hold');
        holdId = hold.id;
      } catch (error) {
        // Lost a race with a concurrent insert: the constraint did its job.
        if (isExclusionViolation(error) || isDeadlock(error)) throw this.bookingConflict(1);
        throw error;
      }

      const settings = await this.settings.get();
      const confirmBy = new Date(
        Math.min(now.getTime() + settings.paymentWindowHours * HOUR_MS, current.startsAt.getTime()),
      );
      const accepted = await this.transition(tx, current, 'accept', {
        acceptedAt: now,
        confirmBy,
        providerNote: input.providerNote ?? null,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'provider',
        actorUserId: provider.userId,
        action: 'booking.accepted',
        fromStatus: current.status,
        toStatus: accepted.status,
        metadata: { holdId, confirmBy: confirmBy.toISOString() },
      });

      // Other pending requests for an overlapping period can no longer be fulfilled.
      const autoDeclined = await tx
        .update(bookings)
        .set({
          status: 'declined',
          declinedAt: now,
          declineReason: 'vehicle_no_longer_available',
          version: sql`${bookings.version} + 1`,
        })
        .where(
          and(
            eq(bookings.vehicleId, current.vehicleId),
            eq(bookings.status, 'requested'),
            ne(bookings.id, current.id),
            lt(bookings.startsAt, current.endsAt),
            gt(bookings.endsAt, current.startsAt),
          ),
        )
        .returning({ id: bookings.id });
      for (const other of autoDeclined) {
        await recordBookingEvent(tx, {
          bookingId: other.id,
          actorType: 'system',
          action: 'booking.declined',
          fromStatus: 'requested',
          toStatus: 'declined',
          metadata: {
            reason: 'vehicle_no_longer_available',
            automatic: true,
            acceptedBookingId: id,
          },
        });
        const otherCtx = await this.contextOrThrow(tx, other.id);
        await this.email.enqueue(
          bookingDeclinedEmail({
            ...bookingEmailBase(otherCtx, otherCtx.customer, this.customerLink(other.id)),
            providerName: otherCtx.provider.displayName,
            reasonLabel: DECLINE_REASON_LABEL.vehicle_no_longer_available,
            note: null,
            automatic: true,
          }),
          tx,
        );
      }

      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingAcceptedEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
          providerName: ctx.provider.displayName,
          confirmBy,
          providerNote: ctx.booking.providerNote,
        }),
        tx,
      );
      this.logger.info(
        { bookingId: id, holdId, autoDeclined: autoDeclined.length, ip: meta.ip },
        'Booking accepted',
      );
    });
    return this.viewFor(id, 'provider');
  }

  async decline(
    provider: ProviderProfile,
    id: string,
    input: DeclineBookingRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    await this.expireIfOverdue(provider.id, id, now);
    await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, id, { providerId: provider.id });
      this.assertVersion(current, input.version);
      const declined = await this.transition(tx, current, 'decline', {
        declinedAt: now,
        declineReason: input.reason,
        declineNote: input.note ?? null,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'provider',
        actorUserId: provider.userId,
        action: 'booking.declined',
        fromStatus: current.status,
        toStatus: declined.status,
        metadata: { reason: input.reason, automatic: false },
      });
      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingDeclinedEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
          providerName: ctx.provider.displayName,
          reasonLabel: DECLINE_REASON_LABEL[input.reason],
          note: input.note ?? null,
          automatic: false,
        }),
        tx,
      );
      this.logger.info({ bookingId: id, reason: input.reason, ip: meta.ip }, 'Booking declined');
    });
    return this.viewFor(id, 'provider');
  }

  async cancelByProvider(
    provider: ProviderProfile,
    id: string,
    input: CancelBookingRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    const settings = await this.settings.get();
    await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, id, { providerId: provider.id });
      this.assertVersion(current, input.version);
      this.assertCanTransition(current, 'cancel_by_provider');
      const released = holdsVehicle(current.status) ? await releaseBookingHold(tx, id) : undefined;
      const settlement = await settlePaymentsOnCancellation(tx, current, {
        cancelledBy: 'provider',
        fullRefundHours: settings.cancellationFullRefundHours,
        now,
      });
      const cancelled = await this.transition(tx, current, 'cancel_by_provider', {
        cancelledAt: now,
        cancelledBy: provider.userId,
        cancellationNote: input.note ?? null,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'provider',
        actorUserId: provider.userId,
        action: 'booking.cancelled',
        fromStatus: current.status,
        toStatus: cancelled.status,
        metadata: {
          by: 'provider',
          holdReleased: released !== undefined,
          refundDueAmount: settlement.refundDueAmount,
        },
      });
      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingCancelledEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
          cancelledBy: 'provider',
          counterpartName: ctx.provider.displayName,
          note: input.note ?? null,
          refundNote: refundNoteFor(settlement),
        }),
        tx,
      );
      this.logger.info({ bookingId: id, ip: meta.ip }, 'Booking cancelled by provider');
    });
    return this.viewFor(id, 'provider');
  }

  async pickup(
    provider: ProviderProfile,
    id: string,
    input: HandoverRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, id, { providerId: provider.id });
      this.assertVersion(current, input.version);
      const active = await this.transition(tx, current, 'pickup', {
        pickedUpAt: now,
        pickupOdometerKm: input.odometerKm ?? null,
        pickupFuelLevel: input.fuelLevel ?? null,
        pickupNote: input.note ?? null,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'provider',
        actorUserId: provider.userId,
        action: 'booking.picked_up',
        fromStatus: current.status,
        toStatus: active.status,
        metadata: { odometerKm: input.odometerKm ?? null, fuelLevel: input.fuelLevel ?? null },
      });
      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingPickedUpEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
          providerName: ctx.provider.displayName,
          pickedUpAt: now,
          record: {
            odometerKm: input.odometerKm ?? null,
            fuelLevel: input.fuelLevel ?? null,
            note: input.note ?? null,
          },
        }),
        tx,
      );
      this.logger.info({ bookingId: id, ip: meta.ip }, 'Booking pickup recorded');
    });
    return this.viewFor(id, 'provider');
  }

  async complete(
    provider: ProviderProfile,
    id: string,
    input: HandoverRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, id, { providerId: provider.id });
      this.assertVersion(current, input.version);
      const completed = await this.transition(tx, current, 'return', {
        completedAt: now,
        returnOdometerKm: input.odometerKm ?? null,
        returnFuelLevel: input.fuelLevel ?? null,
        returnNote: input.note ?? null,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'provider',
        actorUserId: provider.userId,
        action: 'booking.completed',
        fromStatus: current.status,
        toStatus: completed.status,
        metadata: { odometerKm: input.odometerKm ?? null, fuelLevel: input.fuelLevel ?? null },
      });
      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingCompletedEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
          providerName: ctx.provider.displayName,
          completedAt: now,
          record: {
            odometerKm: input.odometerKm ?? null,
            fuelLevel: input.fuelLevel ?? null,
            note: input.note ?? null,
          },
        }),
        tx,
      );
      this.logger.info({ bookingId: id, ip: meta.ip }, 'Booking completed');
    });
    return this.viewFor(id, 'provider');
  }

  async noShow(
    provider: ProviderProfile,
    id: string,
    input: NoShowBookingRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    const settings = await this.settings.get();
    await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, id, { providerId: provider.id });
      this.assertVersion(current, input.version);
      this.assertCanTransition(current, 'no_show');
      const allowedAt = noShowAllowedAt(current.startsAt, settings.noShowGraceHours);
      if (allowedAt > now) {
        throw new ApiException(
          'GRACE_PERIOD_NOT_ELAPSED',
          `A no-show can be recorded from ${allowedAt.toISOString()} (${settings.noShowGraceHours} h after the pickup time)`,
          409,
        );
      }
      const released = await releaseBookingHold(tx, id);
      const marked = await this.transition(tx, current, 'no_show', {
        noShowAt: now,
        noShowNote: input.note,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'provider',
        actorUserId: provider.userId,
        action: 'booking.no_show',
        fromStatus: current.status,
        toStatus: marked.status,
        metadata: { holdReleased: released !== undefined },
      });
      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingNoShowEmail({
          ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
          providerName: ctx.provider.displayName,
        }),
        tx,
      );
      this.logger.info({ bookingId: id, ip: meta.ip }, 'Booking marked as no-show');
    });
    return this.viewFor(id, 'provider');
  }

  // ======================================================= customer actions

  async cancelByCustomer(
    customer: AuthenticatedUser,
    id: string,
    input: CancelBookingRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<BookingView> {
    const settings = await this.settings.get();
    await this.db.transaction(async (tx) => {
      const current = await this.lockOwn(tx, id, { customerUserId: customer.id });
      this.assertVersion(current, input.version);
      this.assertCanTransition(current, 'cancel_by_customer');
      const released = holdsVehicle(current.status) ? await releaseBookingHold(tx, id) : undefined;
      const settlement = await settlePaymentsOnCancellation(tx, current, {
        cancelledBy: 'customer',
        fullRefundHours: settings.cancellationFullRefundHours,
        now,
      });
      const cancelled = await this.transition(tx, current, 'cancel_by_customer', {
        cancelledAt: now,
        cancelledBy: customer.id,
        cancellationNote: input.note ?? null,
      });
      await recordBookingEvent(tx, {
        bookingId: id,
        actorType: 'customer',
        actorUserId: customer.id,
        action: 'booking.cancelled',
        fromStatus: current.status,
        toStatus: cancelled.status,
        metadata: {
          by: 'customer',
          holdReleased: released !== undefined,
          refundDueAmount: settlement.refundDueAmount,
        },
      });
      const ctx = await this.contextOrThrow(tx, id);
      await this.email.enqueue(
        bookingCancelledEmail({
          ...bookingEmailBase(ctx, ctx.owner, this.providerLink(id)),
          cancelledBy: 'customer',
          counterpartName: ctx.customer.fullName,
          note: input.note ?? null,
          refundNote: null,
        }),
        tx,
      );
      if (settlement.paidPaymentId) {
        await this.email.enqueue(
          paymentCancellationRefundEmail({
            ...bookingEmailBase(ctx, ctx.customer, this.customerLink(id)),
            refundDueAmount: settlement.refundDueAmount,
            forfeited: settlement.forfeited,
            fullRefundHours: settings.cancellationFullRefundHours,
          }),
          tx,
        );
      }
      this.logger.info({ bookingId: id, ip: meta.ip }, 'Booking cancelled by customer');
    });
    return this.viewFor(id, 'customer');
  }

  // ======================================================== payment hook

  /**
   * `accepted → confirmed` after a verified, matching, first-time successful
   * advance payment (TECH_DECISIONS D55). Runs inside the payment transaction
   * under the booking row lock. Returns the reason instead of throwing when the
   * booking can no longer be confirmed, so the payment is still recorded as
   * received and flagged for manual resolution. Replaces the Phase 6
   * `confirm-for-testing` bridge (D56), which no longer exists.
   */
  async confirmFromPayment(
    tx: DatabaseExecutor,
    bookingId: string,
    payment: {
      paymentId: string;
      gateway: string;
      gatewayPaymentId: string | null;
      amount: string;
    },
    now: Date,
  ): Promise<{ confirmed: true } | { confirmed: false; reason: string }> {
    const current = await lockBooking(tx, bookingId);
    if (!current) return { confirmed: false, reason: 'booking_missing' };
    if (current.status !== 'accepted') {
      return { confirmed: false, reason: `booking_${current.status}` };
    }
    const hold = await holdOfBooking(tx, bookingId);
    if (!hold) return { confirmed: false, reason: 'no_hold' };
    if (compareAmounts(payment.amount, current.advanceAmount) !== 0) {
      return { confirmed: false, reason: 'advance_mismatch' };
    }
    const confirmed = await this.transition(tx, current, 'confirm', {
      confirmedAt: now,
      confirmedBy: null,
      confirmationSource: 'payment',
    });
    await recordBookingEvent(tx, {
      bookingId,
      actorType: 'system',
      action: 'booking.confirmed',
      fromStatus: current.status,
      toStatus: confirmed.status,
      // Stored in full for audit; customers and providers receive the allow-listed
      // projection (source, gateway, amount, currency) — never the ids.
      metadata: {
        source: 'payment',
        gateway: payment.gateway,
        amount: payment.amount,
        currency: current.currency,
        paymentId: payment.paymentId,
        holdId: hold.id,
      },
    });
    await this.audit.record(
      {
        actorType: 'system',
        action: 'booking.confirmed_by_payment',
        targetType: 'booking',
        targetId: bookingId,
        metadata: {
          paymentId: payment.paymentId,
          gateway: payment.gateway,
          amount: payment.amount,
          reference: current.reference,
        },
      },
      tx,
    );
    const ctx = await this.contextOrThrow(tx, bookingId);
    await this.email.enqueue(
      bookingConfirmedCustomerEmail({
        ...bookingEmailBase(ctx, ctx.customer, this.customerLink(bookingId)),
        providerName: ctx.provider.displayName,
        pickupAddress: ctx.location.addressText,
        pickupInstructions: ctx.location.pickupInstructions,
        advancePaid: payment.amount,
        balanceDue: current.balanceDueAmount,
        securityDeposit: current.securityDepositAmount,
      }),
      tx,
    );
    await this.email.enqueue(
      bookingConfirmedProviderEmail({
        ...bookingEmailBase(ctx, ctx.owner, this.providerLink(bookingId)),
        customerName: ctx.customer.fullName,
      }),
      tx,
    );
    this.logger.info(
      { bookingId, paymentId: payment.paymentId, gateway: payment.gateway },
      'Booking confirmed by payment',
    );
    return { confirmed: true };
  }

  // ============================================================== helpers

  private async list(
    viewer: BookingViewer,
    where: SQL | undefined,
    query: { limit: number; cursor?: string },
  ): Promise<BookingList> {
    const cursor = decodeCursor(query.cursor);
    const rows = await loadBookingContexts(
      this.db,
      and(
        where,
        cursor
          ? or(
              lt(bookings.createdAt, cursor.createdAt),
              and(eq(bookings.createdAt, cursor.createdAt), lt(bookings.id, cursor.id)),
            )
          : undefined,
      ),
      [desc(bookings.createdAt), desc(bookings.id)],
      query.limit + 1,
    );
    const page = paginate(
      rows.map((row) => ({ ...row, createdAt: row.booking.createdAt, id: row.booking.id })),
      query.limit,
    );
    const [photos, settings, paymentsByBooking] = await Promise.all([
      this.photos.listActiveFor(page.data.map((r) => r.vehicle.id)),
      this.settings.get(),
      loadPaymentsForBookings(
        this.db,
        page.data.map((r) => r.booking.id),
      ),
    ]);
    const now = new Date();
    return {
      data: page.data.map((row) =>
        toBookingSummary(row, {
          viewer,
          settings,
          now,
          payments: paymentsByBooking.get(row.booking.id) ?? [],
          thumbnailUrl: this.thumbnail(photos.get(row.vehicle.id)?.[0]?.publicPrefix),
        }),
      ),
      nextCursor: page.nextCursor,
    };
  }

  private statusFilter(
    status: DbBookingStatus | undefined,
    scope: 'open' | 'past' | 'all',
  ): SQL | undefined {
    if (status) return eq(bookings.status, status);
    if (scope === 'open') return inArray(bookings.status, [...OPEN_BOOKING_STATUSES]);
    if (scope === 'past') return inArray(bookings.status, [...TERMINAL_BOOKING_STATUSES]);
    return undefined;
  }

  private async viewFor(id: string, viewer: BookingViewer): Promise<BookingView> {
    const ctx = await this.contextOrThrow(this.db, id);
    return this.render(ctx, viewer);
  }

  private async render(ctx: BookingContext, viewer: BookingViewer): Promise<BookingView> {
    const [events, view] = await Promise.all([
      listBookingEvents(this.db, ctx.booking.id),
      this.viewContext(ctx, viewer),
    ]);
    return toBookingView(ctx, view, events);
  }

  private async viewContext(ctx: BookingContext, viewer: BookingViewer): Promise<ViewContext> {
    const [settings, photos, paymentsByBooking] = await Promise.all([
      this.settings.get(),
      this.photos.listActiveFor([ctx.vehicle.id]),
      loadPaymentsForBookings(this.db, [ctx.booking.id]),
    ]);
    return {
      viewer,
      settings,
      now: new Date(),
      payments: paymentsByBooking.get(ctx.booking.id) ?? [],
      thumbnailUrl: this.thumbnail(photos.get(ctx.vehicle.id)?.[0]?.publicPrefix),
    };
  }

  private thumbnail(publicPrefix: string | undefined): string | null {
    return publicPrefix ? this.photos.variantUrls(publicPrefix).thumb : null;
  }

  private participantRole(ctx: BookingContext, user: AuthenticatedUser): BookingViewer | null {
    if (ctx.booking.customerUserId === user.id) return 'customer';
    if (ctx.provider.userId === user.id) return 'provider';
    return null;
  }

  private async contextOrThrow(executor: DatabaseExecutor, id: string): Promise<BookingContext> {
    const ctx = await loadBookingContext(executor, eq(bookings.id, id));
    if (!ctx) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    return ctx;
  }

  private async lockOwn(
    tx: DatabaseExecutor,
    id: string,
    scope: { customerUserId?: string; providerId?: string } = {},
  ): Promise<BookingRow> {
    const row = await lockBooking(tx, id, scope);
    if (!row) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    return row;
  }

  private assertVersion(current: BookingRow, expected: number): void {
    if (current.version !== expected) {
      throw new ApiException(
        'STALE_VERSION',
        `The booking changed (it is now ${current.status.replaceAll('_', ' ')}); reload and try again`,
        409,
        [{ field: 'version', issue: `expected ${current.version}` }],
      );
    }
  }

  private assertCanTransition(current: BookingRow, action: BookingTransitionAction): void {
    if (!BOOKING_TRANSITIONS[action].from.includes(current.status)) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `Cannot ${action.replaceAll('_', ' ')} a booking that is ${current.status.replaceAll('_', ' ')}`,
        409,
      );
    }
  }

  /** `UPDATE … WHERE status IN (from) AND version = current` with the version bump. */
  private async transition(
    tx: DatabaseExecutor,
    current: BookingRow,
    action: BookingTransitionAction,
    patch: Partial<NewBooking>,
  ): Promise<BookingRow> {
    this.assertCanTransition(current, action);
    const { from, to } = BOOKING_TRANSITIONS[action];
    const [updated] = await tx
      .update(bookings)
      .set({ ...patch, status: to, version: sql`${bookings.version} + 1` })
      .where(
        and(
          eq(bookings.id, current.id),
          eq(bookings.version, current.version),
          inArray(bookings.status, [...from] as DbBookingStatus[]),
        ),
      )
      .returning();
    if (!updated) {
      throw new ApiException(
        'STALE_VERSION',
        'The booking changed concurrently; reload and try again',
        409,
      );
    }
    return updated;
  }

  /** A provider acting on an overdue request finds it expired instead (same path as the sweep). */
  private async expireIfOverdue(providerId: string, id: string, now: Date): Promise<void> {
    const [row] = await this.db
      .select({ status: bookings.status, respondBy: bookings.respondBy })
      .from(bookings)
      .where(and(eq(bookings.id, id), eq(bookings.providerId, providerId)))
      .limit(1);
    if (row && row.status === 'requested' && row.respondBy <= now) {
      await this.expiry.expireRequest(id, now);
      throw new ApiException(
        'REQUEST_EXPIRED',
        'The response window for this request has passed; it has expired',
        410,
      );
    }
  }

  private bookingConflict(count: number): ApiException {
    return new ApiException(
      'BOOKING_CONFLICT',
      'The vehicle is no longer free for these dates',
      409,
      [{ field: 'startsAt', issue: `overlaps ${count} existing hold${count === 1 ? '' : 's'}` }],
    );
  }

  private ruleViolations(
    vehicle: Vehicle,
    startsAt: Date,
    days: number,
    now: Date,
  ): QuoteUnavailableReason[] {
    const reasons: QuoteUnavailableReason[] = [];
    if (startsAt.getTime() < now.getTime() + MIN_BOOKING_LEAD_HOURS * HOUR_MS)
      reasons.push('too_soon');
    if (startsAt.getTime() > now.getTime() + MAX_BOOKING_HORIZON_DAYS * DAY_MS) {
      reasons.push('too_far_ahead');
    }
    if (days < vehicle.minRentalDays) reasons.push('outside_min_days');
    if (vehicle.maxRentalDays !== null && days > vehicle.maxRentalDays)
      reasons.push('outside_max_days');
    return reasons;
  }

  /** Same predicate as public search, so a vehicle is bookable iff it is discoverable. */
  private async loadBookable(
    executor: DatabaseExecutor,
    idOrSlug: string,
  ): Promise<BookableVehicle | undefined> {
    const [row] = await executor
      .select({ vehicle: vehicles, provider: providerProfiles, location: providerLocations })
      .from(vehicles)
      .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
      .innerJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(
        and(
          searchableCondition(),
          UUID.test(idOrSlug) ? eq(vehicles.id, idOrSlug) : eq(vehicles.slug, idOrSlug),
        ),
      )
      .limit(1);
    return row;
  }

  /** Pre-checked so a collision never aborts the surrounding transaction (the unique index stays the guard). */
  private async uniqueReference(tx: DatabaseExecutor): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateBookingReference();
      const [taken] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.reference, candidate))
        .limit(1);
      if (!taken) return candidate;
    }
    throw new Error('Could not allocate a unique booking reference');
  }

  /** The token is excluded: a refreshed quote for the same request must replay, not conflict. */
  private requestHash(
    customerId: string,
    input: CreateBookingRequest,
    startsAt: Date,
    endsAt: Date,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          customerId,
          vehicleId: input.vehicleId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          driver: input.driver,
          customerNote: input.customerNote ?? null,
        }),
      )
      .digest('hex');
  }

  private customerLink(id: string): string {
    return `${this.webAppUrl}/bookings/${id}`;
  }

  private providerLink(id: string): string {
    return `${this.webAppUrl}/provider/bookings/${id}`;
  }
}

const RULE_MESSAGES: Record<QuoteUnavailableReason, string> = {
  not_bookable: 'the vehicle is not bookable',
  date_conflict: 'the vehicle is not available for these dates',
  outside_min_days: 'the rental is shorter than the minimum for this vehicle',
  outside_max_days: 'the rental is longer than the maximum for this vehicle',
  too_soon: `pickup must be at least ${MIN_BOOKING_LEAD_HOURS} hours from now`,
  too_far_ahead: `pickup must be within ${MAX_BOOKING_HORIZON_DAYS} days`,
};

function whatsappLink(e164: string, message: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

/** Wording for the customer about the advance after a cancellation (null when nothing was paid). */
function refundNoteFor(settlement: {
  refundDueAmount: string | null;
  forfeited: boolean;
}): string | null {
  if (settlement.refundDueAmount === null) return null;
  if (settlement.forfeited) {
    return 'Under the cancellation policy the advance you paid is not refundable.';
  }
  return `The advance of ${formatLkr(settlement.refundDueAmount)} you paid will be refunded; our team processes refunds manually and will e-mail you when it is done.`;
}
