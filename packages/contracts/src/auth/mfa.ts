import { z } from 'zod';

import { AuthSessionResponseSchema, PASSWORD_MAX_LENGTH } from './auth';

/**
 * Authenticator-app second factor for privileged accounts (Phase 10,
 * TECH_DECISIONS D67). Enrolment is a two-step proof (start → confirm with a
 * valid code); login for an enrolled account answers with a short-lived
 * challenge instead of a session, which `challenge` (TOTP) or `recovery`
 * (one-time recovery code) turns into a session that carries the factor.
 */
export const MFA_RECOVERY_CODE_COUNT = 8;
export const MFA_CHALLENGE_TTL_SECONDS = 300;
/** Consecutive wrong codes before verification is refused for `MFA_LOCK_MINUTES`. */
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCK_MINUTES = 15;

export const TotpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'enter the 6-digit code from your authenticator app');

/** Ten base32 characters, optionally grouped `XXXXX-XXXXX`; compared case-insensitively. */
export const RecoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z2-7]{5}[\s-]?[A-Za-z2-7]{5}$/, 'malformed recovery code');

const PasswordConfirmationSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const ChallengeTokenSchema = z.string().min(20).max(2048);

export const MfaMethodSchema = z.enum(['totp', 'recovery_code']);
export type MfaMethod = z.infer<typeof MfaMethodSchema>;

export const MfaStatusSchema = z.object({
  /** A confirmed authenticator exists. */
  enrolled: z.boolean(),
  /** An enrolment was started but no code has confirmed it yet. */
  pendingEnrolment: z.boolean(),
  confirmedAt: z.iso.datetime().nullable(),
  recoveryCodesRemaining: z.number().int().min(0),
  /** Whether this account's roles require the factor for privileged routes under the current policy. */
  required: z.boolean(),
  /** Whether the current session has completed the factor. */
  sessionVerified: z.boolean(),
});
export type MfaStatus = z.infer<typeof MfaStatusSchema>;

export const MfaEnrolStartRequestSchema = z.strictObject({
  /** Recent password confirmation. */
  password: PasswordConfirmationSchema,
});
export type MfaEnrolStartRequest = z.infer<typeof MfaEnrolStartRequestSchema>;

/** Shown once; the secret is stored only encrypted and never returned again. */
export const MfaEnrolStartResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  issuer: z.string(),
  account: z.string(),
  algorithm: z.literal('SHA1'),
  digits: z.literal(6),
  period: z.literal(30),
});
export type MfaEnrolStartResponse = z.infer<typeof MfaEnrolStartResponseSchema>;

export const MfaEnrolConfirmRequestSchema = z.strictObject({ code: TotpCodeSchema });
export type MfaEnrolConfirmRequest = z.infer<typeof MfaEnrolConfirmRequestSchema>;

export const MfaRecoveryCodesSchema = z.object({
  /** Displayed once, individually consumable; regeneration invalidates the previous set. */
  recoveryCodes: z.array(z.string()).length(MFA_RECOVERY_CODE_COUNT),
  generatedAt: z.iso.datetime(),
});
export type MfaRecoveryCodes = z.infer<typeof MfaRecoveryCodesSchema>;

/** Confirming enrolment upgrades the current session so the admin can continue without logging in again. */
export const MfaEnrolConfirmResponseSchema = MfaRecoveryCodesSchema.extend({
  session: z.object({
    tokenType: z.literal('Bearer'),
    accessToken: z.string(),
    expiresIn: z.number().int().positive(),
  }),
});
export type MfaEnrolConfirmResponse = z.infer<typeof MfaEnrolConfirmResponseSchema>;

/** Login answer for an enrolled account: no session yet, only a signed challenge. */
export const MfaRequiredResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
  /** Challenge lifetime in seconds. */
  expiresIn: z.number().int().positive(),
  methods: z.array(MfaMethodSchema).min(1),
});
export type MfaRequiredResponse = z.infer<typeof MfaRequiredResponseSchema>;

export const LoginResponseSchema = z.union([AuthSessionResponseSchema, MfaRequiredResponseSchema]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export function isMfaRequiredResponse(value: LoginResponse): value is MfaRequiredResponse {
  return 'mfaRequired' in value && value.mfaRequired === true;
}

export const MfaChallengeRequestSchema = z.strictObject({
  challengeToken: ChallengeTokenSchema,
  code: TotpCodeSchema,
});
export type MfaChallengeRequest = z.infer<typeof MfaChallengeRequestSchema>;

export const MfaRecoveryRequestSchema = z.strictObject({
  challengeToken: ChallengeTokenSchema,
  recoveryCode: RecoveryCodeSchema,
});
export type MfaRecoveryRequest = z.infer<typeof MfaRecoveryRequestSchema>;

/** Disabling or regenerating recovery codes needs the password and a current code. */
export const MfaStepUpRequestSchema = z.strictObject({
  password: PasswordConfirmationSchema,
  code: TotpCodeSchema,
});
export type MfaStepUpRequest = z.infer<typeof MfaStepUpRequestSchema>;
