import { z } from 'zod';

/**
 * Machine-readable error codes. Business-specific codes are added in the
 * phases that introduce them (booking codes: Phase 6).
 */
export const ApiErrorCodeSchema = z.enum([
  // generic (mapped from HTTP status)
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
  // authentication & accounts
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_ALREADY_REGISTERED',
  'ACCOUNT_SUSPENDED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'REFRESH_INVALID',
  'CURRENT_PASSWORD_INVALID',
  // providers
  'INVALID_STATE_TRANSITION',
  'PROVIDER_SUSPENDED',
  // catalogue & availability
  'LOCATION_IN_USE',
  'AVAILABILITY_CONFLICT',
  // bookings
  'BOOKING_CONFLICT',
  'STALE_VERSION',
  'QUOTE_CHANGED',
  'QUOTE_EXPIRED',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_EXPIRED',
  'CONTACT_NOT_AVAILABLE_YET',
  'GRACE_PERIOD_NOT_ELAPSED',
  // payments
  'PAYMENT_WINDOW_EXPIRED',
  'ALREADY_PAID',
  'PAYMENT_GATEWAY_UNAVAILABLE',
  // Phase 8 — reviews
  'REVIEW_WINDOW_CLOSED',
  'ALREADY_REVIEWED',
  'ALREADY_REPLIED',
  'REVIEW_LOCKED_AFTER_REPLY',
  // Phase 9 — admin operations
  'ACCOUNT_ANONYMISATION_BLOCKED',
  'DISPUTE_WINDOW_CLOSED',
  'DISPUTE_ALREADY_EXISTS',
  'SETTING_STALE',
  'SETTING_MONEY_MODEL_UNSUPPORTED',
  // Phase 10 — admin MFA and privacy requests
  'MFA_REQUIRED',
  'MFA_CHALLENGE_INVALID',
  'MFA_CODE_INVALID',
  'MFA_LOCKED',
  'MFA_ALREADY_ENROLLED',
  'MFA_NOT_ENROLLED',
  'PRIVACY_REQUEST_ALREADY_OPEN',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorDetailSchema = z.object({
  /** Dot-path of the offending field, when the error relates to a specific input. */
  field: z.string().optional(),
  issue: z.string(),
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/** Uniform error envelope returned by every non-2xx API response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.array(ApiErrorDetailSchema).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
