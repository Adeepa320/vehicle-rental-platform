import type { PrivacyRequestType } from '@vrp/contracts';

import type { EmailMessage } from './email-provider';
import { APP_NAME, escapeHtml, layout } from './templates';

/**
 * Data-subject request notices (Phase 10). They never carry the exported data,
 * the requester's note or internal notes — only the fact, the status and the
 * operator's public note.
 */
export interface PrivacyEmailBase {
  to: string;
  fullName: string;
  type: PrivacyRequestType;
}

const label = (type: PrivacyRequestType): string =>
  type === 'deletion' ? 'account deletion request' : 'personal data access request';

export function privacyRequestReceivedEmail(input: PrivacyEmailBase): EmailMessage {
  const what = label(input.type);
  const subject = `We received your ${what}`;
  const extra =
    input.type === 'deletion'
      ? 'Deletion removes your personal details and signs you out everywhere; booking, payment and review history is kept in anonymised form as the law requires. Open bookings, open disputes or payments still being resolved must be closed first, and we will tell you if that is the case.'
      : 'You can download your data at any time from your account page under Privacy; this request lets our team confirm the hand-over.';
  const text = [
    `Hi ${input.fullName},`,
    '',
    `We received your ${what} and will respond from the e-mail address you registered with.`,
    extra,
    'You can follow its status on your account page under Privacy.',
  ].join('\n');
  const html = layout(
    `Your ${what}`,
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We received your ${what} and will respond from the e-mail address you registered with.</p>
<p>${escapeHtml(extra)}</p>
<p>You can follow its status on your account page under Privacy.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function privacyRequestCompletedEmail(
  input: PrivacyEmailBase & { publicNote: string | null },
): EmailMessage {
  const what = label(input.type);
  const subject = `Your ${what} has been completed`;
  const note = input.publicNote ? `Note from our team: ${input.publicNote}` : '';
  const text = [`Hi ${input.fullName},`, '', `Your ${what} has been completed.`, note]
    .filter(Boolean)
    .join('\n');
  const html = layout(
    `${what.charAt(0).toUpperCase()}${what.slice(1)} completed`,
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your ${what} has been completed.</p>${note ? `<p>${escapeHtml(note)}</p>` : ''}`,
  );
  return { to: input.to, subject, text, html };
}

export function privacyRequestRejectedEmail(
  input: PrivacyEmailBase & { publicNote: string },
): EmailMessage {
  const what = label(input.type);
  const subject = `About your ${what}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `We could not complete your ${what} as submitted.`,
    `Reason: ${input.publicNote}`,
    'Reply to this e-mail or write to support if you would like to discuss it.',
  ].join('\n');
  const html = layout(
    `About your ${what}`,
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We could not complete your ${what} as submitted.</p>
<p>Reason: ${escapeHtml(input.publicNote)}</p>
<p>Reply to this e-mail or write to support if you would like to discuss it.</p>`,
  );
  return { to: input.to, subject, text, html };
}

/** Operator inbox notice: ids and type only, never the requester's details or note. */
export function operatorPrivacyRequestEmail(input: {
  to: string;
  type: PrivacyRequestType;
  requestId: string;
  requestedAt: Date;
  webAppUrl: string;
}): EmailMessage {
  const subject = `[Ops] New ${input.type} request (privacy)`;
  const link = `${input.webAppUrl}/admin/privacy-requests/${input.requestId}`;
  const text = [
    `A ${input.type} request was submitted at ${input.requestedAt.toISOString()} on ${APP_NAME}.`,
    `Review it in the console: ${link}`,
  ].join('\n');
  const html = layout(
    'New privacy request',
    `<p>A ${escapeHtml(input.type)} request was submitted at ${input.requestedAt.toISOString()}.</p>
<p><a href="${escapeHtml(link)}">Review it in the console</a></p>`,
  );
  return { to: input.to, subject, text, html };
}
