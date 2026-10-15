import {
  ANONYMISED_REVIEWER_NAME,
  reviewerDisplayName,
  type AdminReview,
  type CustomerReview,
  type ProviderReview,
  type PublicReview,
  type ReviewEditLock,
} from '@vrp/contracts';
import type { ReviewRow, Vehicle } from '@vrp/database';

import { vehicleTitleOf } from '../bookings/booking.persistence';

/** One review with the rows the views need (loaded by `ReviewsService.rows`). */
export interface ReviewRowSet {
  review: ReviewRow;
  customer: {
    id: string;
    fullName: string;
    email: string;
    status: 'active' | 'suspended' | 'deleted';
  };
  vehicle: Vehicle;
  booking: { id: string; reference: string; completedAt: Date | null };
  provider: { id: string; displayName: string };
}

/**
 * Allow-list projections (SECURITY_AND_PRIVACY §3.2). The public view carries
 * the ratings, the comment, the provider's reply, dates and a privacy-conscious
 * reviewer name only — never the customer's full name, e-mail, user id, the
 * booking id, booking dates or moderation fields.
 */
export function toPublicReview(row: ReviewRowSet): PublicReview {
  const r = row.review;
  return {
    id: r.id,
    overallRating: r.overallRating,
    vehicleRating: r.vehicleRating,
    serviceRating: r.serviceRating,
    communicationRating: r.communicationRating,
    comment: r.comment,
    reviewer: {
      // An anonymised account (Phase 9) never shows its placeholder name as "Deleted U.".
      displayName:
        row.customer.status === 'deleted'
          ? ANONYMISED_REVIEWER_NAME
          : reviewerDisplayName(row.customer.fullName),
    },
    providerReply: r.providerReply,
    providerRepliedAt: r.providerRepliedAt ? r.providerRepliedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function vehicleRef(vehicle: Vehicle): { id: string; slug: string; title: string } {
  return { id: vehicle.id, slug: vehicle.slug ?? vehicle.id, title: vehicleTitleOf(vehicle) };
}

/** Whether (and until when) the customer may still edit, or why not. */
export interface ReviewEditability {
  canEditUntil: Date | null;
  lock: ReviewEditLock | null;
}

/**
 * Editing rules (TECH_DECISIONS D57): published, inside the review window and
 * — permanently — only until the provider has replied. The same order is
 * enforced server-side in `ReviewsService.update`.
 */
export function reviewEditability(
  review: Pick<ReviewRowSet['review'], 'status' | 'providerReply'>,
  windowClosesAt: Date | null,
  now: Date,
): ReviewEditability {
  if (review.status !== 'published') return { canEditUntil: null, lock: 'hidden' };
  if (review.providerReply !== null) return { canEditUntil: null, lock: 'provider_replied' };
  if (!windowClosesAt || windowClosesAt <= now)
    return { canEditUntil: null, lock: 'window_closed' };
  return { canEditUntil: windowClosesAt, lock: null };
}

export function toCustomerReview(
  row: ReviewRowSet,
  editability: ReviewEditability,
): CustomerReview {
  return {
    ...toPublicReview(row),
    bookingId: row.booking.id,
    status: row.review.status,
    vehicle: vehicleRef(row.vehicle),
    canEditUntil: editability.canEditUntil ? editability.canEditUntil.toISOString() : null,
    editLockReason: editability.lock,
  };
}

/** Provider inbox: adds the booking reference and the vehicle, keeps the display name only. */
export function toProviderReview(row: ReviewRowSet): ProviderReview {
  return {
    ...toPublicReview(row),
    status: row.review.status,
    booking: { id: row.booking.id, reference: row.booking.reference },
    vehicle: vehicleRef(row.vehicle),
  };
}

export function toAdminReview(row: ReviewRowSet): AdminReview {
  const r = row.review;
  return {
    ...toProviderReview(row),
    customer: { id: row.customer.id, name: row.customer.fullName, email: row.customer.email },
    provider: { id: row.provider.id, displayName: row.provider.displayName },
    hiddenAt: r.hiddenAt ? r.hiddenAt.toISOString() : null,
    hiddenReason: r.hiddenReason,
    hiddenBy: r.hiddenBy,
  };
}
