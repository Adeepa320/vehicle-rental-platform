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

function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

function quote(text: string): string {
  return `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #ccc;color:#333">${escapeHtml(text)}</blockquote>`;
}

// ----------------------------------------------------------------- accounts

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
${button(input.link, 'Verify email')}
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
${button(input.link, 'Reset password')}
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

// ---------------------------------------------------------------- providers

export interface ProviderEmailBase {
  to: string;
  fullName: string;
  displayName: string;
}

export function providerApplicationReceivedEmail(
  input: ProviderEmailBase & { statusLink: string },
): EmailMessage {
  const subject = `We received your provider application (${input.displayName})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Thanks for applying to list ${input.displayName} on ${APP_NAME}.`,
    'Our team reviews every application manually and may contact you by phone or e-mail to confirm details.',
    'You can follow the status here:',
    input.statusLink,
  ].join('\n');
  const html = layout(
    'Application received',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Thanks for applying to list <strong>${escapeHtml(input.displayName)}</strong> on ${escapeHtml(APP_NAME)}.</p>
<p>Our team reviews every application manually and may contact you by phone or e-mail to confirm details.</p>
${button(input.statusLink, 'View application status')}`,
  );
  return { to: input.to, subject, text, html };
}

export function providerChangesRequestedEmail(
  input: ProviderEmailBase & { reason: string; link: string },
): EmailMessage {
  const subject = `Action needed on your provider application (${input.displayName})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'Our team reviewed your application and needs a few changes before it can be approved:',
    '',
    input.reason,
    '',
    'Update your application and resubmit it here:',
    input.link,
  ].join('\n');
  const html = layout(
    'Changes requested',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team reviewed your application for <strong>${escapeHtml(input.displayName)}</strong> and needs a few changes before it can be approved:</p>
${quote(input.reason)}
${button(input.link, 'Update and resubmit')}`,
  );
  return { to: input.to, subject, text, html };
}

export function providerApprovedEmail(
  input: ProviderEmailBase & { dashboardLink: string },
): EmailMessage {
  const subject = `${input.displayName} is approved on ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Good news: ${input.displayName} has been approved as a platform-reviewed provider.`,
    'Your provider dashboard is ready. Vehicle listings open in the next release.',
    input.dashboardLink,
  ].join('\n');
  const html = layout(
    'You are approved',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Good news: <strong>${escapeHtml(input.displayName)}</strong> has been approved as a platform-reviewed provider.</p>
<p>Your provider dashboard is ready. Vehicle listings open in the next release.</p>
${button(input.dashboardLink, 'Open provider dashboard')}`,
  );
  return { to: input.to, subject, text, html };
}

export function providerRejectedEmail(input: ProviderEmailBase & { reason: string }): EmailMessage {
  const subject = `Update on your provider application (${input.displayName})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `We are sorry: we cannot approve the application for ${input.displayName} at this time.`,
    '',
    input.reason,
    '',
    'If you believe this is a mistake, reply to our support team.',
  ].join('\n');
  const html = layout(
    'Application not approved',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We are sorry: we cannot approve the application for <strong>${escapeHtml(input.displayName)}</strong> at this time.</p>
${quote(input.reason)}
<p style="font-size:13px;color:#444">If you believe this is a mistake, contact our support team.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function providerSuspendedEmail(
  input: ProviderEmailBase & { reason: string },
): EmailMessage {
  const subject = `${input.displayName} has been suspended on ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your provider account ${input.displayName} has been suspended:`,
    '',
    input.reason,
    '',
    'You can still sign in and view your profile, but provider actions are disabled until the issue is resolved. Contact support to continue.',
  ].join('\n');
  const html = layout(
    'Provider account suspended',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your provider account <strong>${escapeHtml(input.displayName)}</strong> has been suspended:</p>
${quote(input.reason)}
<p style="font-size:13px;color:#444">You can still sign in and view your profile, but provider actions are disabled until the issue is resolved. Contact support to continue.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function providerReactivatedEmail(
  input: ProviderEmailBase & { dashboardLink: string },
): EmailMessage {
  const subject = `${input.displayName} is active again on ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your provider account ${input.displayName} has been reactivated. Welcome back.`,
    input.dashboardLink,
  ].join('\n');
  const html = layout(
    'Provider account reactivated',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your provider account <strong>${escapeHtml(input.displayName)}</strong> has been reactivated. Welcome back.</p>
${button(input.dashboardLink, 'Open provider dashboard')}`,
  );
  return { to: input.to, subject, text, html };
}

export interface OperatorNewApplicationInput {
  to: string;
  displayName: string;
  applicantEmail: string;
  reviewLink: string;
}

/** Internal notice to the platform operator; contains only what the admin page shows anyway. */
export function operatorNewApplicationEmail(input: OperatorNewApplicationInput): EmailMessage {
  const subject = `New provider application: ${input.displayName}`;
  const text = [
    `A provider application was submitted for review.`,
    `Business: ${input.displayName}`,
    `Applicant: ${input.applicantEmail}`,
    input.reviewLink,
  ].join('\n');
  const html = layout(
    'New provider application',
    `<p>A provider application was submitted for review.</p>
<p><strong>${escapeHtml(input.displayName)}</strong><br>${escapeHtml(input.applicantEmail)}</p>
${button(input.reviewLink, 'Review application')}`,
  );
  return { to: input.to, subject, text, html };
}
