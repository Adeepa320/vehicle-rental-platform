import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DISPUTABLE_BOOKING_STATUSES,
  DISPUTE_REASON_LABEL,
  DISPUTE_RESOLUTION_LABEL,
  type AdminDispute,
  type AdminDisputeList,
  type AdminDisputeListQuery,
  type BookingDisputeState,
  type Dispute,
  type DisputeInternalNoteRequest,
  type DisputeMessageRequest,
  type DisputeParty,
  type OpenDisputeRequest,
  type RejectDisputeRequest,
  type ResolveDisputeRequest,
  type StartDisputeReviewRequest,
} from '@vrp/contracts';
import {
  bookings,
  disputeMessages,
  disputes,
  type Booking,
  type Database,
  type DatabaseExecutor,
  type DisputeMessageRow,
  type DisputeRow,
} from '@vrp/database';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
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
  loadBookingContexts,
  lockBooking,
  vehicleTitleOf,
  type BookingContext,
} from '../bookings/booking.persistence';
import {
  disputeDecidedEmail,
  disputeMessageEmail,
  disputeOpenedEmail,
  operatorDisputeOpenedEmail,
} from '../notifications/email/admin-templates';
import { EmailService } from '../notifications/email/email.service';
import { NotificationsService } from '../notifications/inapp/notifications.service';
import { loadPaymentsForBookings, paymentSummaryFor } from '../payments/payment.persistence';
import { toAdminDispute, toAdminDisputeSummary, toParticipantDispute } from './dispute.mappers';

const DAY_MS = 86_400_000;

interface Participant {
  userId: string;
  role: DisputeParty;
}

/**
 * Lean disputes (Phase 9, TECH_DECISIONS D62). The participant relationship
 * is always derived from the booking row (customer or vehicle owner); clients
 * never send ids. One dispute per booking, opened inside the window after
 * the relevant event; an append-only thread; an admin decision with a public
 * note. Nothing here changes payments: `refund_recommended` is a pointer to
 * the Phase 7 refund tooling, not a mutation.
 */
@Injectable()
export class DisputesService {
  private readonly webAppUrl: string;
  private readonly operatorEmail: string | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: BookingSettingsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DisputesService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    this.operatorEmail = config.get('OPERATOR_NOTIFICATION_EMAIL', { infer: true });
  }

  // --------------------------------------------------------- participants

  async stateForBooking(
    user: AuthenticatedUser,
    bookingId: string,
    now = new Date(),
  ): Promise<BookingDisputeState> {
    const ctx = await loadBookingContext(this.db, eq(bookings.id, bookingId));
    const participant = ctx ? this.participantOf(ctx, user) : null;
    if (!ctx || !participant) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
    const [existing] = await this.db
      .select()
      .from(disputes)
      .where(eq(disputes.bookingId, bookingId))
      .limit(1);
    const settings = await this.settings.get();
    const windowClosesAt = this.windowClosesAt(ctx.booking, settings.disputeWindowDays);
    if (existing) {
      return {
        eligible: false,
        reason: 'already_exists',
        windowClosesAt: windowClosesAt ? windowClosesAt.toISOString() : null,
        dispute: await this.participantView(this.db, existing, ctx, participant),
      };
    }
    if (!this.isDisputableStatus(ctx.booking.status)) {
      return {
        eligible: false,
        reason: 'not_disputable_status',
        windowClosesAt: null,
        dispute: null,
      };
    }
    if (windowClosesAt && windowClosesAt <= now) {
      return {
        eligible: false,
        reason: 'window_closed',
        windowClosesAt: windowClosesAt.toISOString(),
        dispute: null,
      };
    }
    return {
      eligible: true,
      reason: null,
      windowClosesAt: windowClosesAt ? windowClosesAt.toISOString() : null,
      dispute: null,
    };
  }

  async open(
    user: AuthenticatedUser,
    bookingId: string,
    input: OpenDisputeRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<Dispute> {
    const settings = await this.settings.get();
    const id = await this.db.transaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      const ctx = booking ? await loadBookingContext(tx, eq(bookings.id, bookingId)) : undefined;
      const participant = ctx ? this.participantOf(ctx, user) : null;
      if (!booking || !ctx || !participant) {
        throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      }
      if (!this.isDisputableStatus(booking.status)) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `A dispute can be opened on an active, completed, no-show or cancelled booking (this one is ${booking.status.replaceAll('_', ' ')})`,
          409,
        );
      }
      const closesAt = this.windowClosesAt(booking, settings.disputeWindowDays);
      if (closesAt && closesAt <= now) {
        throw new ApiException(
          'DISPUTE_WINDOW_CLOSED',
          `Disputes must be opened within ${settings.disputeWindowDays} days (the window closed on ${closesAt.toISOString()})`,
          409,
        );
      }
      const [existing] = await tx
        .select({ id: disputes.id })
        .from(disputes)
        .where(eq(disputes.bookingId, bookingId))
        .limit(1);
      if (existing) {
        throw new ApiException(
          'DISPUTE_ALREADY_EXISTS',
          'A dispute already exists for this booking',
          409,
        );
      }
      const [row] = await tx
        .insert(disputes)
        .values({
          bookingId,
          openedByUserId: user.id,
          openedByRole: participant.role,
          reasonCode: input.reasonCode,
          description: input.description,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        throw new ApiException(
          'DISPUTE_ALREADY_EXISTS',
          'A dispute already exists for this booking',
          409,
        );
      }
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: participant.role,
          action: 'dispute.opened',
          targetType: 'dispute',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { bookingId, reasonCode: input.reasonCode, openedBy: participant.role },
        },
        tx,
      );
      const counterpart = participant.role === 'customer' ? ctx.owner : ctx.customer;
      const link = this.linkFor(
        participant.role === 'customer' ? 'provider' : 'customer',
        bookingId,
      );
      await this.notifications.create(tx, {
        userId: counterpart.id,
        type: 'dispute.opened',
        title: `Dispute opened on booking ${ctx.booking.reference}`,
        body: `${participant.role === 'customer' ? 'The customer' : 'The provider'} opened a dispute (${DISPUTE_REASON_LABEL[input.reasonCode]}). Read it and reply on the dispute page.`,
        linkPath: link,
        metadata: { bookingId, disputeId: row.id },
        dedupeKey: `dispute:${row.id}:opened`,
      });
      await this.email.enqueue(
        disputeOpenedEmail({
          to: counterpart.email,
          fullName: counterpart.fullName,
          reference: ctx.booking.reference,
          vehicleTitle: vehicleTitleOf(ctx.vehicle),
          link: `${this.webAppUrl}${link}`,
          openedBy: participant.role,
          reasonLabel: DISPUTE_REASON_LABEL[input.reasonCode],
        }),
        tx,
      );
      if (this.operatorEmail) {
        await this.email.enqueue(
          operatorDisputeOpenedEmail({
            to: this.operatorEmail,
            reference: ctx.booking.reference,
            openedBy: participant.role,
            reasonLabel: DISPUTE_REASON_LABEL[input.reasonCode],
            link: `${this.webAppUrl}/admin/disputes/${row.id}`,
          }),
          tx,
        );
      }
      this.logger.info({ disputeId: row.id, bookingId, role: participant.role }, 'Dispute opened');
      return row.id;
    });
    return this.getForParticipant(user, id);
  }

  async getForParticipant(user: AuthenticatedUser, id: string): Promise<Dispute> {
    const { row, ctx, participant } = await this.loadParticipant(this.db, user, id);
    return this.participantView(this.db, row, ctx, participant);
  }

  async addMessage(
    user: AuthenticatedUser,
    id: string,
    input: DisputeMessageRequest,
    meta: RequestMeta,
  ): Promise<Dispute> {
    await this.db.transaction(async (tx) => {
      const { row, ctx, participant } = await this.loadParticipant(tx, user, id, true);
      this.assertOpen(row);
      const [message] = await tx
        .insert(disputeMessages)
        .values({
          disputeId: row.id,
          authorUserId: user.id,
          authorRole: participant.role,
          body: input.body,
        })
        .returning();
      if (!message) throw new Error('Failed to store message');
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: participant.role,
          action: 'dispute.message_posted',
          targetType: 'dispute',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { messageId: message.id, bookingId: row.bookingId },
        },
        tx,
      );
      const counterpart = participant.role === 'customer' ? ctx.owner : ctx.customer;
      await this.notifyMessage(tx, row, ctx, message, {
        userId: counterpart.id,
        email: counterpart.email,
        fullName: counterpart.fullName,
        link: this.linkFor(
          participant.role === 'customer' ? 'provider' : 'customer',
          row.bookingId,
        ),
        authorLabel: participant.role === 'customer' ? 'The customer' : ctx.provider.displayName,
      });
    });
    return this.getForParticipant(user, id);
  }

  // ---------------------------------------------------------------- admin

  async listForAdmin(query: AdminDisputeListQuery): Promise<AdminDisputeList> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select({ dispute: disputes })
      .from(disputes)
      .where(
        and(
          query.status ? eq(disputes.status, query.status) : undefined,
          query.bookingId ? eq(disputes.bookingId, query.bookingId) : undefined,
          cursor
            ? or(
                lt(disputes.createdAt, cursor.createdAt),
                and(eq(disputes.createdAt, cursor.createdAt), lt(disputes.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(disputes.createdAt), desc(disputes.id))
      .limit(query.limit + 1);
    const page = paginate(
      rows.map((r) => ({ ...r, createdAt: r.dispute.createdAt, id: r.dispute.id })),
      query.limit,
    );
    const contexts = await loadBookingContexts(
      this.db,
      page.data.length > 0
        ? inArray(
            bookings.id,
            page.data.map((r) => r.dispute.bookingId),
          )
        : sql`false`,
      [asc(bookings.createdAt)],
      page.data.length,
    );
    const byBooking = new Map(contexts.map((c) => [c.booking.id, c]));
    const counts = new Map<string, number>();
    if (page.data.length > 0) {
      const rowsByDispute = await this.db
        .select({ disputeId: disputeMessages.disputeId, count: sql<number>`count(*)::int` })
        .from(disputeMessages)
        .where(
          inArray(
            disputeMessages.disputeId,
            page.data.map((r) => r.dispute.id),
          ),
        )
        .groupBy(disputeMessages.disputeId);
      for (const row of rowsByDispute) counts.set(row.disputeId, row.count);
    }
    return {
      data: page.data.flatMap((r) => {
        const ctx = byBooking.get(r.dispute.bookingId);
        return ctx ? [toAdminDisputeSummary(r.dispute, ctx, counts.get(r.dispute.id) ?? 0)] : [];
      }),
      nextCursor: page.nextCursor,
    };
  }

  async getForAdmin(id: string): Promise<AdminDispute> {
    const [row] = await this.db.select().from(disputes).where(eq(disputes.id, id)).limit(1);
    const ctx = row ? await loadBookingContext(this.db, eq(bookings.id, row.bookingId)) : undefined;
    if (!row || !ctx) throw new ApiException('NOT_FOUND', 'Dispute not found', 404);
    const [messages, payments] = await Promise.all([
      this.messages(this.db, row.id),
      loadPaymentsForBookings(this.db, [row.bookingId]),
    ]);
    return toAdminDispute(
      row,
      ctx,
      messages,
      paymentSummaryFor(ctx.booking, payments.get(row.bookingId) ?? []),
    );
  }

  async startReview(
    admin: AuthenticatedUser,
    id: string,
    input: StartDisputeReviewRequest,
    meta: RequestMeta,
  ): Promise<AdminDispute> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockAdmin(tx, id);
      if (row.status !== 'open') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `Only an open dispute can be taken into review (this one is ${row.status.replaceAll('_', ' ')})`,
          409,
        );
      }
      await tx
        .update(disputes)
        .set({ status: 'in_review', assignedAdminId: admin.id })
        .where(and(eq(disputes.id, id), eq(disputes.status, 'open')));
      await this.audit.record(
        this.adminEvent(admin, 'dispute.review_started', row, meta, input.note ?? null),
        tx,
      );
    });
    return this.getForAdmin(id);
  }

  async addAdminMessage(
    admin: AuthenticatedUser,
    id: string,
    input: DisputeMessageRequest,
    meta: RequestMeta,
  ): Promise<AdminDispute> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockAdmin(tx, id);
      this.assertOpen(row);
      const ctx = await loadBookingContext(tx, eq(bookings.id, row.bookingId));
      if (!ctx) throw new ApiException('NOT_FOUND', 'Booking not found', 404);
      const [message] = await tx
        .insert(disputeMessages)
        .values({
          disputeId: row.id,
          authorUserId: admin.id,
          authorRole: 'admin',
          body: input.body,
        })
        .returning();
      if (!message) throw new Error('Failed to store message');
      await this.audit.record(
        this.adminEvent(admin, 'dispute.message_posted', row, meta, null, {
          messageId: message.id,
        }),
        tx,
      );
      for (const party of ['customer', 'provider'] as const) {
        const recipient = party === 'customer' ? ctx.customer : ctx.owner;
        await this.notifyMessage(tx, row, ctx, message, {
          userId: recipient.id,
          email: recipient.email,
          fullName: recipient.fullName,
          link: this.linkFor(party, row.bookingId),
          authorLabel: 'The platform team',
        });
      }
    });
    return this.getForAdmin(id);
  }

  /** Admin-only note; never notifies anyone (spec §32). */
  async setInternalNote(
    admin: AuthenticatedUser,
    id: string,
    input: DisputeInternalNoteRequest,
    meta: RequestMeta,
  ): Promise<AdminDispute> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockAdmin(tx, id);
      await tx.update(disputes).set({ internalAdminNote: input.note }).where(eq(disputes.id, id));
      await this.audit.record(
        this.adminEvent(admin, 'dispute.internal_note_updated', row, meta, null),
        tx,
      );
    });
    return this.getForAdmin(id);
  }

  async resolve(
    admin: AuthenticatedUser,
    id: string,
    input: ResolveDisputeRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminDispute> {
    await this.decide(
      admin,
      id,
      'resolved',
      input.publicNote,
      input.internalNote,
      input.resolutionCode,
      meta,
      now,
    );
    return this.getForAdmin(id);
  }

  async reject(
    admin: AuthenticatedUser,
    id: string,
    input: RejectDisputeRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminDispute> {
    await this.decide(admin, id, 'rejected', input.publicNote, input.internalNote, null, meta, now);
    return this.getForAdmin(id);
  }

  /** Open disputes a user is party to (anonymisation blocker, overview). */
  async countOpenForUser(userId: string, providerId: string | null): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(disputes)
      .innerJoin(bookings, eq(bookings.id, disputes.bookingId))
      .where(
        and(
          inArray(disputes.status, ['open', 'in_review']),
          providerId
            ? or(eq(bookings.customerUserId, userId), eq(bookings.providerId, providerId))
            : eq(bookings.customerUserId, userId),
        ),
      );
    return row?.count ?? 0;
  }

  // -------------------------------------------------------------- helpers

  private async decide(
    admin: AuthenticatedUser,
    id: string,
    outcome: 'resolved' | 'rejected',
    publicNote: string,
    internalNote: string | undefined,
    resolutionCode: ResolveDisputeRequest['resolutionCode'] | null,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockAdmin(tx, id);
      this.assertOpen(row);
      const [updated] = await tx
        .update(disputes)
        .set({
          status: outcome,
          resolutionCode,
          publicResolutionNote: publicNote,
          ...(internalNote !== undefined ? { internalAdminNote: internalNote } : {}),
          resolvedBy: admin.id,
          resolvedAt: now,
          assignedAdminId: row.assignedAdminId ?? admin.id,
        })
        .where(and(eq(disputes.id, id), inArray(disputes.status, ['open', 'in_review'])))
        .returning();
      if (!updated) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'The dispute was decided concurrently',
          409,
        );
      }
      await this.audit.record(
        this.adminEvent(admin, `dispute.${outcome}`, row, meta, publicNote, {
          resolutionCode,
        }),
        tx,
      );
      const ctx = await loadBookingContext(tx, eq(bookings.id, row.bookingId));
      if (!ctx) return;
      const resolutionLabel = resolutionCode ? DISPUTE_RESOLUTION_LABEL[resolutionCode] : null;
      for (const party of ['customer', 'provider'] as const) {
        const recipient = party === 'customer' ? ctx.customer : ctx.owner;
        const link = this.linkFor(party, row.bookingId);
        await this.notifications.create(tx, {
          userId: recipient.id,
          type: outcome === 'resolved' ? 'dispute.resolved' : 'dispute.rejected',
          title:
            outcome === 'resolved'
              ? `Dispute on booking ${ctx.booking.reference} resolved`
              : `Dispute on booking ${ctx.booking.reference} not upheld`,
          body: `${resolutionLabel ? `${resolutionLabel}. ` : ''}${publicNote}`,
          linkPath: link,
          metadata: { bookingId: row.bookingId, disputeId: row.id },
          dedupeKey: `dispute:${row.id}:${outcome}:${party}`,
        });
        await this.email.enqueue(
          disputeDecidedEmail({
            to: recipient.email,
            fullName: recipient.fullName,
            reference: ctx.booking.reference,
            vehicleTitle: vehicleTitleOf(ctx.vehicle),
            link: `${this.webAppUrl}${link}`,
            outcome,
            resolutionLabel,
            publicNote,
          }),
          tx,
        );
      }
      this.logger.info({ disputeId: id, outcome, adminId: admin.id }, 'Dispute decided');
    });
  }

  private async notifyMessage(
    tx: DatabaseExecutor,
    row: DisputeRow,
    ctx: BookingContext,
    message: DisputeMessageRow,
    recipient: {
      userId: string;
      email: string;
      fullName: string;
      link: string;
      authorLabel: string;
    },
  ): Promise<void> {
    const created = await this.notifications.create(tx, {
      userId: recipient.userId,
      type: 'dispute.message',
      title: `New message in the dispute on booking ${ctx.booking.reference}`,
      body: `${recipient.authorLabel} wrote: ${message.body.slice(0, 200)}`,
      linkPath: recipient.link,
      metadata: { bookingId: row.bookingId, disputeId: row.id },
      dedupeKey: `dispute:${row.id}:message:${message.id}:${recipient.userId}`,
    });
    if (!created) return;
    await this.email.enqueue(
      disputeMessageEmail({
        to: recipient.email,
        fullName: recipient.fullName,
        reference: ctx.booking.reference,
        vehicleTitle: vehicleTitleOf(ctx.vehicle),
        link: `${this.webAppUrl}${recipient.link}`,
        authorLabel: recipient.authorLabel,
        body: message.body,
      }),
      tx,
    );
  }

  private async participantView(
    executor: DatabaseExecutor,
    row: DisputeRow,
    ctx: BookingContext,
    participant: Participant,
  ): Promise<Dispute> {
    return toParticipantDispute(row, ctx, await this.messages(executor, row.id), participant);
  }

  private messages(executor: DatabaseExecutor, disputeId: string): Promise<DisputeMessageRow[]> {
    return executor
      .select()
      .from(disputeMessages)
      .where(eq(disputeMessages.disputeId, disputeId))
      .orderBy(asc(disputeMessages.createdAt), asc(disputeMessages.id));
  }

  private async loadParticipant(
    executor: DatabaseExecutor,
    user: AuthenticatedUser,
    id: string,
    forUpdate = false,
  ): Promise<{ row: DisputeRow; ctx: BookingContext; participant: Participant }> {
    const query = executor.select().from(disputes).where(eq(disputes.id, id)).limit(1);
    const [row] = forUpdate ? await query.for('update') : await query;
    const ctx = row
      ? await loadBookingContext(executor, eq(bookings.id, row.bookingId))
      : undefined;
    const participant = ctx ? this.participantOf(ctx, user) : null;
    if (!row || !ctx || !participant) throw new ApiException('NOT_FOUND', 'Dispute not found', 404);
    return { row, ctx, participant };
  }

  private async lockAdmin(tx: DatabaseExecutor, id: string): Promise<DisputeRow> {
    const [row] = await tx.select().from(disputes).where(eq(disputes.id, id)).for('update');
    if (!row) throw new ApiException('NOT_FOUND', 'Dispute not found', 404);
    return row;
  }

  private assertOpen(row: DisputeRow): void {
    if (row.status !== 'open' && row.status !== 'in_review') {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `The dispute is ${row.status}; no further messages or decisions are possible`,
        409,
      );
    }
  }

  private participantOf(ctx: BookingContext, user: AuthenticatedUser): Participant | null {
    if (ctx.booking.customerUserId === user.id) return { userId: user.id, role: 'customer' };
    if (ctx.provider.userId === user.id) return { userId: user.id, role: 'provider' };
    return null;
  }

  private isDisputableStatus(status: Booking['status']): boolean {
    return (DISPUTABLE_BOOKING_STATUSES as readonly string[]).includes(status);
  }

  /** The window starts at the event that makes the booking disputable; an active rental has no deadline yet. */
  private windowClosesAt(booking: Booking, windowDays: number): Date | null {
    const anchor =
      booking.status === 'completed'
        ? booking.completedAt
        : booking.status === 'no_show'
          ? booking.noShowAt
          : booking.status.startsWith('cancelled_')
            ? booking.cancelledAt
            : null;
    return anchor ? new Date(anchor.getTime() + windowDays * DAY_MS) : null;
  }

  private linkFor(party: DisputeParty, bookingId: string): string {
    return party === 'customer'
      ? `/bookings/${bookingId}/dispute`
      : `/provider/bookings/${bookingId}/dispute`;
  }

  private adminEvent(
    admin: AuthenticatedUser,
    action: string,
    row: DisputeRow,
    meta: RequestMeta,
    reason: string | null,
    extra: Record<string, unknown> = {},
  ) {
    return {
      actorUserId: admin.id,
      actorType: 'admin' as const,
      action,
      targetType: 'dispute',
      targetId: row.id,
      reason,
      ip: meta.ip ?? null,
      metadata: { bookingId: row.bookingId, ...extra },
    };
  }
}
