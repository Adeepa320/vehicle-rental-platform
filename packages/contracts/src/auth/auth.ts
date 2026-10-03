import { z } from 'zod';

import { CountryCodeSchema, EmailSchema, LanguageSchema, UserSchema } from './user';

/** Version string stamped on `users.terms_version` at registration. Bump when the terms change. */
export const CURRENT_TERMS_VERSION = '2026-10' as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`);

/** Opaque one-time token as delivered in e-mail links (base64url, 32 random bytes = 43 chars). */
export const OneTimeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'malformed token');

/** Which kind of client is authenticating; decides how the refresh token is delivered. */
export const AuthClientSchema = z.enum(['web', 'mobile']);
export type AuthClient = z.infer<typeof AuthClientSchema>;

export const RegisterRequestSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(100),
  email: EmailSchema,
  password: PasswordSchema,
  /** Must be `true`; the server stamps the current terms version. */
  acceptTerms: z.literal(true, { error: 'you must accept the terms and privacy policy' }),
  preferredLanguage: LanguageSchema.optional(),
  countryCode: CountryCodeSchema.optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z.object({
  user: UserSchema,
  verification: z.object({ emailSent: z.boolean() }),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  client: AuthClientSchema.default('web'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Returned by login and refresh. For `web` clients the refresh token travels
 * in an HttpOnly cookie and `refreshToken` is absent; `mobile` clients get it
 * in the body.
 */
export const AuthSessionResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string().optional(),
  user: UserSchema,
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

/** Body for refresh/logout; web clients may omit the body entirely (cookie carries the token). */
export const RefreshRequestSchema = z
  .strictObject({
    refreshToken: z.string().min(20).max(512).optional(),
  })
  .default({});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const VerifyEmailRequestSchema = z.strictObject({ token: OneTimeTokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendVerificationRequestSchema = z.strictObject({ email: EmailSchema });
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

export const ForgotPasswordRequestSchema = z.strictObject({ email: EmailSchema });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.strictObject({
  token: OneTimeTokenSchema,
  newPassword: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/** Generic acknowledgement for enumeration-safe endpoints. */
export const MessageResponseSchema = z.object({ message: z.string() });
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const VerifyEmailResponseSchema = z.object({ verified: z.literal(true), email: z.email() });
export type VerifyEmailResponse = z.infer<typeof VerifyEmailResponseSchema>;
