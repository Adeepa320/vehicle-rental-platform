import type { EmailMessage } from './email-provider';

const APP_NAME = 'Vehicle Rental Platform';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="margin-top:32px;font-size:12px;color:#666">${escapeHtml(APP_NAME)} · This is an automated message; replies are not monitored.</p>
</body></html>`;
}

export interface VerificationEmailInput {
  to: string;
  fullName: string;
  link: string;
  expiresInHours: number;
}

export function verificationEmail(input: VerificationEmailInput): EmailMessage {
  const subject = `Verify your email for ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Confirm your email address to finish creating your ${APP_NAME} account:`,
    input.link,
    '',
    `This link expires in ${input.expiresInHours} hours and can be used once.`,
    'If you did not create an account, you can ignore this email.',
  ].join('\n');
  const html = layout(
    'Verify your email',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Confirm your email address to finish creating your ${escapeHtml(APP_NAME)} account.</p>
<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Verify email</a></p>
<p style="font-size:13px;color:#444">Or paste this link into your browser:<br>${escapeHtml(input.link)}</p>
<p style="font-size:13px;color:#444">This link expires in ${input.expiresInHours} hours and can be used once. If you did not create an account, you can ignore this email.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export interface PasswordResetEmailInput {
  to: string;
  fullName: string;
  link: string;
  expiresInMinutes: number;
}

export function passwordResetEmail(input: PasswordResetEmailInput): EmailMessage {
  const subject = `Reset your ${APP_NAME} password`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'We received a request to reset your password. Use this link to choose a new one:',
    input.link,
    '',
    `This link expires in ${input.expiresInMinutes} minutes and can be used once.`,
    'If you did not request a password reset, you can ignore this email; your password will not change.',
  ].join('\n');
  const html = layout(
    'Reset your password',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We received a request to reset your password. Use the button below to choose a new one.</p>
<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Reset password</a></p>
<p style="font-size:13px;color:#444">Or paste this link into your browser:<br>${escapeHtml(input.link)}</p>
<p style="font-size:13px;color:#444">This link expires in ${input.expiresInMinutes} minutes and can be used once. If you did not request a reset, ignore this email; your password will not change.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export interface PasswordChangedEmailInput {
  to: string;
  fullName: string;
}

export function passwordChangedEmail(input: PasswordChangedEmailInput): EmailMessage {
  const subject = `Your ${APP_NAME} password was changed`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'Your password was just changed and all existing sessions were signed out.',
    'If this was not you, reset your password immediately and contact support.',
  ].join('\n');
  const html = layout(
    'Your password was changed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your password was just changed and all existing sessions were signed out.</p>
<p style="font-size:13px;color:#444">If this was not you, reset your password immediately and contact support.</p>`,
  );
  return { to: input.to, subject, text, html };
}
