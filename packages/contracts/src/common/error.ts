import { z } from 'zod';

/**
 * Machine-readable error codes. Business-specific codes (BOOKING_CONFLICT,
 * QUOTE_CHANGED, ...) are added in the phases that introduce them.
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
  // providers
  'INVALID_STATE_TRANSITION',
  'PROVIDER_SUSPENDED',
  // catalogue & availability
  'LOCATION_IN_USE',
  'AVAILABILITY_CONFLICT',
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
