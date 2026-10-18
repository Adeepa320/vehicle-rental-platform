import { ApiClientError } from '@/lib/api-client';

/**
 * Why a privileged route refused the caller with `403 MFA_REQUIRED`:
 * `enrolment_required` — the account has no authenticator yet;
 * `challenge_required` — the account is enrolled but this session was opened
 * before enrolment (or without the factor) and must be re-established.
 */
export type MfaIssue = 'enrolment_required' | 'challenge_required';

export interface MfaRequirement {
  issue: MfaIssue;
  message: string;
}

/** Extracts the MFA requirement from an API error, or null for any other failure. */
export function mfaRequirementFrom(error: unknown): MfaRequirement | null {
  if (!(error instanceof ApiClientError) || error.code !== 'MFA_REQUIRED') return null;
  const detail = error.details?.find((d) => d.field === 'mfa');
  const issue: MfaIssue =
    detail?.issue === 'challenge_required' ? 'challenge_required' : 'enrolment_required';
  return { issue, message: error.message };
}

/** Whether the account's roles put it under the admin MFA policy (UI shaping only). */
export function isPrivilegedRole(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((role) => role === 'admin' || role === 'super_admin');
}
