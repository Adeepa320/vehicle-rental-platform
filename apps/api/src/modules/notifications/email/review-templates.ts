import type { EmailMessage } from './email-provider';
import { APP_NAME, button, escapeHtml, layout, quote } from './templates';

/**
 * Review e-mails (Phase 8). User-written text (comments, replies, reasons)
 * is escaped in HTML and quoted verbatim in plain text; no ids beyond the
 * booking reference, no contact details.
 */
interface ReviewEmailBase {
  to: string;
  fullName: string;
  reference: string;
  vehicleTitle: string;
  link: string;
}

function stars(rating: number): string {
  return `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)`;
}

export function reviewReceivedProviderEmail(
  input: ReviewEmailBase & { reviewerName: string; overallRating: number; comment: string | null },
): EmailMessage {
  const subject = `New review for ${input.vehicleTitle} (booking ${input.reference})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.reviewerName} reviewed booking ${input.reference}: ${stars(input.overallRating)}.`,
    ...(input.comment ? ['', `"${input.comment}"`] : []),
    '',
    'You can reply once from your provider area; your reply is shown publicly next to the review.',
    input.link,
  ].join('\n');
  const html = layout(
    'New review',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.reviewerName)}</strong> reviewed booking ${escapeHtml(input.reference)}: ${escapeHtml(stars(input.overallRating))}.</p>
${input.comment ? quote(input.comment) : ''}
<p>You can reply once from your provider area; your reply is shown publicly next to the review.</p>
${button(input.link, 'See the review')}`,
  );
  return { to: input.to, subject, text, html };
}

export function reviewReplyCustomerEmail(
  input: ReviewEmailBase & { providerName: string; reply: string },
): EmailMessage {
  const subject = `${input.providerName} replied to your review of ${input.vehicleTitle}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.providerName} replied to your review of booking ${input.reference}:`,
    '',
    `"${input.reply}"`,
    '',
    input.link,
  ].join('\n');
  const html = layout(
    'Reply to your review',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.providerName)}</strong> replied to your review of booking ${escapeHtml(input.reference)}:</p>
${quote(input.reply)}
${button(input.link, 'View your review')}`,
  );
  return { to: input.to, subject, text, html };
}

export function reviewHiddenCustomerEmail(
  input: ReviewEmailBase & { reason: string },
): EmailMessage {
  const subject = `Your review of ${input.vehicleTitle} has been hidden`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team hid your review of booking ${input.reference} on ${APP_NAME}. Reason given: ${input.reason}`,
    '',
    'The review is kept on your booking page but is no longer shown publicly. Reply to this e-mail if you think this was a mistake.',
    input.link,
  ].join('\n');
  const html = layout(
    'Review hidden',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team hid your review of booking ${escapeHtml(input.reference)} on ${escapeHtml(APP_NAME)}.</p>
<p><strong>Reason given:</strong> ${escapeHtml(input.reason)}</p>
<p>The review is kept on your booking page but is no longer shown publicly. Reply to this e-mail if you think this was a mistake.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function reviewUnhiddenCustomerEmail(input: ReviewEmailBase): EmailMessage {
  const subject = `Your review of ${input.vehicleTitle} is visible again`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your review of booking ${input.reference} is shown publicly again on ${APP_NAME}.`,
    input.link,
  ].join('\n');
  const html = layout(
    'Review restored',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your review of booking ${escapeHtml(input.reference)} is shown publicly again on ${escapeHtml(APP_NAME)}.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}
