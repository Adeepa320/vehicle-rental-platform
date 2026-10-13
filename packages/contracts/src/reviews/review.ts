import { z } from 'zod';

/**
 * Reviews (Phase 8, TECH_DECISIONS D57). One customer review per completed
 * booking, published immediately, moderated reactively by admins (hide with a
 * reason / unhide). The provider may reply once. Public responses are built
 * by allow-list mappers and never carry customer, booking or moderation
 * details beyond what is listed here.
 */
export const RatingSchema = z.number().int().min(1).max(5);
export type Rating = z.infer<typeof RatingSchema>;

export const ReviewStatusSchema = z.enum(['published', 'hidden']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_REPLY_MAX = 1000;

/** `POST` / `PUT /bookings/{id}/review`. Every identity field is derived from the booking server side. */
export const CreateReviewRequestSchema = z.strictObject({
  overallRating: RatingSchema,
  vehicleRating: RatingSchema.optional(),
  serviceRating: RatingSchema.optional(),
  communicationRating: RatingSchema.optional(),
  comment: z.string().trim().min(1).max(REVIEW_COMMENT_MAX).optional(),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

/** `POST /providers/me/reviews/{id}/reply` — one reply per review. */
export const ReplyReviewRequestSchema = z.strictObject({
  reply: z.string().trim().min(1).max(REVIEW_REPLY_MAX),
});
export type ReplyReviewRequest = z.infer<typeof ReplyReviewRequestSchema>;

export const HideReviewRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
export type HideReviewRequest = z.infer<typeof HideReviewRequestSchema>;

export const UnhideReviewRequestSchema = z.strictObject({
  note: z.string().trim().max(500).optional(),
});
export type UnhideReviewRequest = z.infer<typeof UnhideReviewRequestSchema>;

/**
 * Aggregate over published reviews. `average` is computed in SQL
 * (`round(avg(overall_rating)::numeric, 1)`) and carried as a string so no
 * floating-point rounding happens in application code; `null` when there is
 * nothing to average (never a manufactured value).
 */
export const RatingSummarySchema = z.object({
  average: z
    .string()
    .regex(/^[1-5]\.\d$/)
    .nullable(),
  count: z.number().int().min(0),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;
export const EMPTY_RATING_SUMMARY: RatingSummary = { average: null, count: 0 };

export const ReviewRatingsSchema = z.object({
  overallRating: RatingSchema,
  vehicleRating: RatingSchema.nullable(),
  serviceRating: RatingSchema.nullable(),
  communicationRating: RatingSchema.nullable(),
});

/** What anyone may see on a listing page. */
export const PublicReviewSchema = ReviewRatingsSchema.extend({
  id: z.uuid(),
  comment: z.string().nullable(),
  /** Privacy-conscious name, e.g. "Nimal P." */
  reviewer: z.object({ displayName: z.string() }),
  providerReply: z.string().nullable(),
  providerRepliedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PublicReview = z.infer<typeof PublicReviewSchema>;

export const ReviewListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>;

export const PublicReviewListSchema = z.object({
  data: z.array(PublicReviewSchema),
  nextCursor: z.string().nullable(),
  summary: RatingSummarySchema,
});
export type PublicReviewList = z.infer<typeof PublicReviewListSchema>;

const ReviewVehicleRefSchema = z.object({ id: z.uuid(), slug: z.string(), title: z.string() });

/**
 * Why the customer cannot edit an existing review right now; null while it is
 * editable. `provider_replied` is permanent: once a reply exists the review is
 * locked so the public reply always refers to the text it answered.
 */
export const ReviewEditLockSchema = z.enum(['window_closed', 'provider_replied', 'hidden']);
export type ReviewEditLock = z.infer<typeof ReviewEditLockSchema>;

/** The customer's own review as shown on their booking page. */
export const CustomerReviewSchema = PublicReviewSchema.extend({
  bookingId: z.uuid(),
  status: ReviewStatusSchema,
  vehicle: ReviewVehicleRefSchema,
  /** Until when the customer may still edit (the review window), null once locked. */
  canEditUntil: z.iso.datetime().nullable(),
  /** Set whenever `canEditUntil` is null for an existing review. */
  editLockReason: ReviewEditLockSchema.nullable(),
});
export type CustomerReview = z.infer<typeof CustomerReviewSchema>;

export const ReviewIneligibilityReasonSchema = z.enum([
  'not_completed',
  'window_closed',
  'already_reviewed',
]);

/** `GET /bookings/{id}/review`: eligibility plus the existing review, if any. */
export const BookingReviewStateSchema = z.object({
  bookingId: z.uuid(),
  reference: z.string(),
  vehicle: ReviewVehicleRefSchema,
  eligible: z.boolean(),
  reason: ReviewIneligibilityReasonSchema.nullable(),
  /** End of the review window (`completed_at + review_window_days`), null before completion. */
  windowClosesAt: z.iso.datetime().nullable(),
  review: CustomerReviewSchema.nullable(),
});
export type BookingReviewState = z.infer<typeof BookingReviewStateSchema>;

/** Provider inbox view: no customer identifiers beyond the display name. */
export const ProviderReviewSchema = PublicReviewSchema.extend({
  status: ReviewStatusSchema,
  booking: z.object({ id: z.uuid(), reference: z.string() }),
  vehicle: ReviewVehicleRefSchema,
});
export type ProviderReview = z.infer<typeof ProviderReviewSchema>;

export const ProviderReviewListSchema = z.object({
  data: z.array(ProviderReviewSchema),
  nextCursor: z.string().nullable(),
});
export type ProviderReviewList = z.infer<typeof ProviderReviewListSchema>;

/** Admin moderation view. */
export const AdminReviewSchema = ProviderReviewSchema.extend({
  customer: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  provider: z.object({ id: z.uuid(), displayName: z.string() }),
  hiddenAt: z.iso.datetime().nullable(),
  hiddenReason: z.string().nullable(),
  hiddenBy: z.uuid().nullable(),
});
export type AdminReview = z.infer<typeof AdminReviewSchema>;

export const AdminReviewListQuerySchema = ReviewListQuerySchema.extend({
  status: ReviewStatusSchema.optional(),
});
export type AdminReviewListQuery = z.infer<typeof AdminReviewListQuerySchema>;

export const AdminReviewListSchema = z.object({
  data: z.array(AdminReviewSchema),
  nextCursor: z.string().nullable(),
});
export type AdminReviewList = z.infer<typeof AdminReviewListSchema>;

/**
 * Deterministic, privacy-conscious reviewer name: first name plus the initial
 * of the last name ("Nimal Perera" → "Nimal P."). A single name stays as is.
 */
export function reviewerDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? 'Customer';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last?.charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}
