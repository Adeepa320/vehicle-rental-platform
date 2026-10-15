import {
  DisputeReasonCodeSchema,
  DisputeResolutionCodeSchema,
  type AdminDispute,
  type AdminDisputeSummary,
  type BookingPaymentSummary,
  type Dispute,
  type DisputeMessage,
  type DisputeParty,
} from '@vrp/contracts';
import type { DisputeMessageRow, DisputeRow } from '@vrp/database';

import { firstName, vehicleTitleOf, type BookingContext } from '../bookings/booking.persistence';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Allow-list projections (SECURITY_AND_PRIVACY §3.2). Participants never see
 * the internal admin note, the other party's e-mail or phone, user ids or the
 * assigned admin; message authors are shown as a role plus a safe display
 * name. Admins get the full operational view.
 */
export function messageAuthorName(
  message: Pick<DisputeMessageRow, 'authorRole' | 'authorUserId'>,
  ctx: BookingContext,
  viewerUserId: string | null,
): string {
  if (viewerUserId && message.authorUserId === viewerUserId) return 'You';
  if (message.authorRole === 'admin') return 'Platform team';
  if (message.authorRole === 'provider') return ctx.provider.displayName;
  return ctx.customer.status === 'deleted' ? 'Former customer' : firstName(ctx.customer.fullName);
}

export function toDisputeMessage(
  row: DisputeMessageRow,
  ctx: BookingContext,
  viewerUserId: string | null,
): DisputeMessage {
  return {
    id: row.id,
    authorRole: row.authorRole as DisputeMessage['authorRole'],
    authorName: messageAuthorName(row, ctx, viewerUserId),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

function common(row: DisputeRow, ctx: BookingContext) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    bookingReference: ctx.booking.reference,
    bookingStatus: ctx.booking.status,
    vehicleTitle: vehicleTitleOf(ctx.vehicle),
    openedBy: row.openedByRole as DisputeParty,
    reasonCode: DisputeReasonCodeSchema.parse(row.reasonCode),
    description: row.description,
    status: row.status,
    resolutionCode: row.resolutionCode
      ? DisputeResolutionCodeSchema.parse(row.resolutionCode)
      : null,
    publicResolutionNote: row.publicResolutionNote,
    resolvedAt: iso(row.resolvedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toParticipantDispute(
  row: DisputeRow,
  ctx: BookingContext,
  messages: DisputeMessageRow[],
  viewer: { userId: string; role: DisputeParty },
): Dispute {
  return {
    ...common(row, ctx),
    openedByMe: row.openedByRole === viewer.role,
    messages: messages.map((m) => toDisputeMessage(m, ctx, viewer.userId)),
    canMessage: row.status === 'open' || row.status === 'in_review',
  };
}

export function toAdminDispute(
  row: DisputeRow,
  ctx: BookingContext,
  messages: DisputeMessageRow[],
  payment: BookingPaymentSummary,
): AdminDispute {
  return {
    ...common(row, ctx),
    messages: messages.map((m) => toDisputeMessage(m, ctx, null)),
    customer: { id: ctx.customer.id, name: ctx.customer.fullName, email: ctx.customer.email },
    provider: {
      id: ctx.provider.id,
      displayName: ctx.provider.displayName,
      ownerEmail: ctx.owner.email,
    },
    openedByUserId: row.openedByUserId,
    assignedAdminId: row.assignedAdminId,
    internalAdminNote: row.internalAdminNote,
    resolvedBy: row.resolvedBy,
    payment,
    bookingStartsAt: ctx.booking.startsAt.toISOString(),
    bookingEndsAt: ctx.booking.endsAt.toISOString(),
  };
}

export function toAdminDisputeSummary(
  row: DisputeRow,
  ctx: BookingContext,
  messageCount: number,
): AdminDisputeSummary {
  return {
    id: row.id,
    bookingId: row.bookingId,
    bookingReference: ctx.booking.reference,
    bookingStatus: ctx.booking.status,
    vehicleTitle: vehicleTitleOf(ctx.vehicle),
    providerDisplayName: ctx.provider.displayName,
    customerName: ctx.customer.fullName,
    openedBy: row.openedByRole as DisputeParty,
    reasonCode: DisputeReasonCodeSchema.parse(row.reasonCode),
    status: row.status,
    assignedAdminId: row.assignedAdminId,
    messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
