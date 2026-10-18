import type { EmailMessage } from './email-provider';
import { APP_NAME, escapeHtml, layout } from './templates';

/**
 * Security notices for the authenticator-app factor (Phase 10). They never
 * contain codes, secrets or links that act on the account — only the fact
 * that something changed and what to do if it was not the account holder.
 */
export interface MfaEmailInput {
  to: string;
  fullName: string;
}

const NOT_YOU =
  'If this was not you, sign in, change your password and contact support immediately.';

export function mfaEnabledEmail(input: MfaEmailInput): EmailMessage {
  const subject = `Two-factor authentication was enabled on your ${APP_NAME} account`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'An authenticator app was just enrolled as the second factor for your account.',
    'Keep the recovery codes you were shown somewhere safe; each one works once.',
    NOT_YOU,
  ].join('\n');
  const html = layout(
    'Two-factor authentication enabled',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>An authenticator app was just enrolled as the second factor for your account.</p>
<p>Keep the recovery codes you were shown somewhere safe; each one works once.</p>
<p style="font-size:13px;color:#444">${NOT_YOU}</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function mfaDisabledEmail(input: MfaEmailInput): EmailMessage {
  const subject = `Two-factor authentication was disabled on your ${APP_NAME} account`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'The authenticator-app factor was removed from your account. Administrator features stay unavailable until you enrol again.',
    NOT_YOU,
  ].join('\n');
  const html = layout(
    'Two-factor authentication disabled',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>The authenticator-app factor was removed from your account. Administrator features stay unavailable until you enrol again.</p>
<p style="font-size:13px;color:#444">${NOT_YOU}</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function mfaRecoveryCodeUsedEmail(
  input: MfaEmailInput & { remaining: number },
): EmailMessage {
  const subject = `A recovery code was used to sign in to ${APP_NAME}`;
  const remaining = `${input.remaining} recovery code${input.remaining === 1 ? '' : 's'} remain${input.remaining === 1 ? 's' : ''}.`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'One of your two-factor recovery codes was just used to sign in. It cannot be used again.',
    remaining,
    'If you have lost your authenticator, enrol a new one from your account security page.',
    NOT_YOU,
  ].join('\n');
  const html = layout(
    'A recovery code was used',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>One of your two-factor recovery codes was just used to sign in. It cannot be used again.</p>
<p>${remaining}</p>
<p>If you have lost your authenticator, enrol a new one from your account security page.</p>
<p style="font-size:13px;color:#444">${NOT_YOU}</p>`,
  );
  return { to: input.to, subject, text, html };
}
