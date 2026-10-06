import { formatLkr } from '@vrp/contracts';

import { formatColombo, type BookingEmailBase } from './booking-templates';
import type { EmailMessage } from './email-provider';
import { APP_NAME, button, escapeHtml, layout, quote } from './templates';

/** Customer: the advance payment did not go through; they can retry until the deadline. */
export function paymentFailedEmail(
  input: BookingEmailBase & { outcome: 'failed' | 'cancelled'; confirmBy: Date | null },
): EmailMessage {
  const subject = `Payment ${input.outcome === 'failed' ? 'failed' : 'cancelled'} for booking ${input.reference}`;
  const lead =
    input.outcome === 'failed'
      ? 'Your advance payment did not go through.'
      : 'Your advance payment was cancelled before it completed.';
  const deadline = input.confirmBy
    ? `You can try again until ${formatColombo(input.confirmBy)} (Sri Lanka time); after that the reservation is released.`
    : 'You can try again from your booking page.';
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${lead} Nothing has been charged. The vehicle is still reserved for you.`,
    deadline,
    `Booking ${input.reference} · ${input.vehicleTitle} · ${formatColombo(input.startsAt)} → ${formatColombo(input.endsAt)}`,
    input.link,
  ].join('\n');
  const html = layout(
    'Payment not completed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(lead)} Nothing has been charged. The vehicle is still reserved for you.</p>
<p>${escapeHtml(deadline)}</p>
<p>Booking <strong>${escapeHtml(input.reference)}</strong> · ${escapeHtml(input.vehicleTitle)}</p>
${button(input.link, 'Try again')}`,
  );
  return { to: input.to, subject, text, html };
}

/** Customer: a verified payment arrived after the booking had expired or was cancelled. */
export function paymentLateSuccessEmail(
  input: BookingEmailBase & { amount: string; bookingStatus: string },
): EmailMessage {
  const subject = `Your payment for ${input.reference} was received after the booking closed`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `We received your advance of ${formatLkr(input.amount)}, but booking ${input.reference} had already ${input.bookingStatus.replaceAll('_', ' ')} and the vehicle is no longer reserved for you.`,
    'Our team will contact you to arrange a refund. You do not need to do anything else.',
    input.link,
  ].join('\n');
  const html = layout(
    'Payment received after the booking closed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We received your advance of <strong>${escapeHtml(formatLkr(input.amount))}</strong>, but booking <strong>${escapeHtml(input.reference)}</strong> had already ${escapeHtml(input.bookingStatus.replaceAll('_', ' '))} and the vehicle is no longer reserved for you.</p>
<p>Our team will contact you to arrange a refund. You do not need to do anything else.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

/** Customer who cancelled a paid booking: whether the advance comes back. */
export function paymentCancellationRefundEmail(
  input: BookingEmailBase & {
    refundDueAmount: string | null;
    forfeited: boolean;
    fullRefundHours: number;
  },
): EmailMessage {
  const refundable = !input.forfeited && input.refundDueAmount !== null;
  const subject = refundable
    ? `Your advance for ${input.reference} will be refunded`
    : `Your advance for ${input.reference} is not refundable`;
  const lead = refundable
    ? `You cancelled booking ${input.reference} more than ${input.fullRefundHours} hours before pickup, so the advance of ${formatLkr(input.refundDueAmount)} will be refunded in full. Our team processes refunds manually and will e-mail you once it is done.`
    : `You cancelled booking ${input.reference} less than ${input.fullRefundHours} hours before pickup. Under the cancellation policy the advance you paid is not refundable.`;
  const text = [`Hi ${input.fullName},`, '', lead, input.link].join('\n');
  const html = layout(
    refundable ? 'Refund on its way' : 'Advance not refundable',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(lead)}</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

/** Customer: an admin recorded the refund of their advance. */
export function paymentRefundRecordedEmail(
  input: BookingEmailBase & {
    amount: string;
    reference: string;
    reason: string;
    refundReference: string;
  },
): EmailMessage {
  const subject = `Refund of ${formatLkr(input.amount)} recorded for booking ${input.reference}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `A refund of ${formatLkr(input.amount)} for booking ${input.reference} has been processed (reference ${input.refundReference}).`,
    `Reason: ${input.reason}`,
    'Card refunds appear on your statement within a few business days; bank transfers arrive once your bank processes them.',
    input.link,
  ].join('\n');
  const html = layout(
    'Refund recorded',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>A refund of <strong>${escapeHtml(formatLkr(input.amount))}</strong> for booking <strong>${escapeHtml(input.reference)}</strong> has been processed (reference ${escapeHtml(input.refundReference)}).</p>
${quote(input.reason)}
<p>Card refunds appear on your statement within a few business days; bank transfers arrive once your bank processes them.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

/** Operator: something about a payment needs a human (mismatch, late success, chargeback, refund due). */
export function paymentAnomalyOperatorEmail(input: {
  to: string;
  reference: string;
  paymentId: string;
  orderId: string;
  anomaly: string;
  amount: string;
  currency: string;
  detail: string;
  link: string;
}): EmailMessage {
  const subject = `Payment needs attention: ${input.anomaly.replaceAll('_', ' ')} (${input.reference})`;
  const text = [
    `A payment on ${APP_NAME} requires manual resolution.`,
    `Booking: ${input.reference}`,
    `Payment: ${input.paymentId} (order ${input.orderId})`,
    `Anomaly: ${input.anomaly}`,
    `Amount: ${input.currency} ${input.amount}`,
    input.detail,
    input.link,
  ].join('\n');
  const html = layout(
    'Payment needs attention',
    `<p>A payment requires manual resolution.</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:2px 12px 2px 0;color:#666">Booking</td><td>${escapeHtml(input.reference)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Payment</td><td>${escapeHtml(input.paymentId)} (order ${escapeHtml(input.orderId)})</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Anomaly</td><td><strong>${escapeHtml(input.anomaly)}</strong></td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Amount</td><td>${escapeHtml(input.currency)} ${escapeHtml(input.amount)}</td></tr>
</table>
<p>${escapeHtml(input.detail)}</p>
${button(input.link, 'Open in admin')}`,
  );
  return { to: input.to, subject, text, html };
}
