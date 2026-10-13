import { formatLkr } from '@vrp/contracts';

import { formatColombo, type BookingEmailBase } from './booking-templates';
import type { EmailMessage } from './email-provider';
import { APP_NAME, button, escapeHtml, layout } from './templates';

/**
 * Reminder e-mails (Phase 8, TECH_DECISIONS D58). Each is sent at most once
 * per booking (the in-app notification's dedupe key gates the e-mail inside
 * the same transaction). Plain text + HTML, escaped, no secrets or ids beyond
 * the booking reference.
 */

export function paymentReminderEmail(
  input: BookingEmailBase & { providerName: string; advance: string; confirmBy: Date },
): EmailMessage {
  const deadline = formatColombo(input.confirmBy);
  const subject = `Reminder: pay the advance for booking ${input.reference} by ${deadline}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.providerName} is holding ${input.vehicleTitle} for you (booking ${input.reference}, pickup ${formatColombo(input.startsAt)}, Sri Lanka time), but the booking is only confirmed once the advance of ${formatLkr(input.advance)} is paid.`,
    `Please pay by ${deadline} (Sri Lanka time); after that the reservation is released automatically.`,
    `The remaining ${formatLkr(input.subtotal)} rental balance and the refundable deposit are paid to the provider at pickup.`,
    '',
    input.link,
  ].join('\n');
  const html = layout(
    'Payment reminder',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.providerName)}</strong> is holding ${escapeHtml(input.vehicleTitle)} for you (booking ${escapeHtml(input.reference)}, pickup ${escapeHtml(formatColombo(input.startsAt))}, Sri Lanka time), but the booking is only confirmed once the advance of <strong>${escapeHtml(formatLkr(input.advance))}</strong> is paid.</p>
<p>Please pay by <strong>${escapeHtml(deadline)}</strong> (Sri Lanka time); after that the reservation is released automatically.</p>
<p>The remaining ${escapeHtml(formatLkr(input.subtotal))} rental balance and the refundable deposit are paid to the provider at pickup.</p>
${button(input.link, 'Pay the advance')}`,
  );
  return { to: input.to, subject, text, html };
}

export function pickupReminderCustomerEmail(
  input: BookingEmailBase & {
    providerName: string;
    pickupAddress: string;
    pickupInstructions: string | null;
    balanceDue: string;
    securityDeposit: string;
  },
): EmailMessage {
  const subject = `Reminder: pickup of ${input.vehicleTitle} on ${formatColombo(input.startsAt)}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your rental of ${input.vehicleTitle} from ${input.providerName} starts ${formatColombo(input.startsAt)} (Sri Lanka time), booking ${input.reference}.`,
    `Pickup address: ${input.pickupAddress}`,
    ...(input.pickupInstructions ? [`Pickup instructions: ${input.pickupInstructions}`] : []),
    `Bring the driver's physical licence. At pickup you pay the provider the ${formatLkr(input.balanceDue)} rental balance plus the refundable deposit of ${formatLkr(input.securityDeposit)}.`,
    `The provider's phone number and WhatsApp link are on your booking page.`,
    '',
    input.link,
  ].join('\n');
  const html = layout(
    'Pickup reminder',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your rental of <strong>${escapeHtml(input.vehicleTitle)}</strong> from ${escapeHtml(input.providerName)} starts <strong>${escapeHtml(formatColombo(input.startsAt))}</strong> (Sri Lanka time), booking ${escapeHtml(input.reference)}.</p>
<p><strong>Pickup address:</strong> ${escapeHtml(input.pickupAddress)}</p>
${input.pickupInstructions ? `<p><strong>Pickup instructions:</strong> ${escapeHtml(input.pickupInstructions)}</p>` : ''}
<p>Bring the driver's physical licence. At pickup you pay the provider the ${escapeHtml(formatLkr(input.balanceDue))} rental balance plus the refundable deposit of ${escapeHtml(formatLkr(input.securityDeposit))}.</p>
<p>The provider's phone number and WhatsApp link are on your booking page.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function pickupReminderProviderEmail(
  input: BookingEmailBase & { customerName: string },
): EmailMessage {
  const subject = `Reminder: handover of ${input.vehicleTitle} on ${formatColombo(input.startsAt)} (${input.reference})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.customerName} picks up ${input.vehicleTitle} on ${formatColombo(input.startsAt)} (Sri Lanka time), booking ${input.reference}, for ${input.rentalDays} day${input.rentalDays === 1 ? '' : 's'}.`,
    `Check the physical licence, collect the balance and the deposit, and record the pickup (odometer and fuel) in your provider area.`,
    '',
    input.link,
  ].join('\n');
  const html = layout(
    'Handover reminder',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.customerName)}</strong> picks up ${escapeHtml(input.vehicleTitle)} on <strong>${escapeHtml(formatColombo(input.startsAt))}</strong> (Sri Lanka time), booking ${escapeHtml(input.reference)}, for ${input.rentalDays} day${input.rentalDays === 1 ? '' : 's'}.</p>
<p>Check the physical licence, collect the balance and the deposit, and record the pickup (odometer and fuel) in your provider area.</p>
${button(input.link, 'Open booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function reviewReminderEmail(
  input: BookingEmailBase & { providerName: string; windowClosesAt: Date },
): EmailMessage {
  const subject = `How was your rental of ${input.vehicleTitle}? (booking ${input.reference})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `You completed a rental of ${input.vehicleTitle} from ${input.providerName}. A short review helps other travellers and the provider; it takes a minute.`,
    `Reviews can be left until ${formatColombo(input.windowClosesAt)} (Sri Lanka time).`,
    '',
    input.link,
    '',
    `Thank you for renting with ${APP_NAME}.`,
  ].join('\n');
  const html = layout(
    'How was your rental?',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>You completed a rental of <strong>${escapeHtml(input.vehicleTitle)}</strong> from ${escapeHtml(input.providerName)}. A short review helps other travellers and the provider; it takes a minute.</p>
<p>Reviews can be left until ${escapeHtml(formatColombo(input.windowClosesAt))} (Sri Lanka time).</p>
${button(input.link, 'Leave a review')}
<p>Thank you for renting with ${escapeHtml(APP_NAME)}.</p>`,
  );
  return { to: input.to, subject, text, html };
}
