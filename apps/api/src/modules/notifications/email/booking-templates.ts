import { formatLkr } from '@vrp/contracts';

import type { EmailMessage } from './email-provider';
import { APP_NAME, button, escapeHtml, layout, quote } from './templates';

/** Instant in Sri Lanka time, e.g. "12 Nov 2026, 09:00". */
export function formatColombo(value: Date | string): string {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Colombo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Facts every booking e-mail repeats. */
export interface BookingEmailBase {
  to: string;
  /** Recipient's name. */
  fullName: string;
  reference: string;
  vehicleTitle: string;
  startsAt: Date;
  endsAt: Date;
  rentalDays: number;
  /** Rental subtotal (canonical amount string). */
  subtotal: string;
  /** Link to the booking page for the recipient. */
  link: string;
}

function summaryText(b: BookingEmailBase): string[] {
  return [
    `Booking ${b.reference}`,
    `Vehicle: ${b.vehicleTitle}`,
    `Pickup: ${formatColombo(b.startsAt)} (Sri Lanka time)`,
    `Return: ${formatColombo(b.endsAt)}`,
    `${b.rentalDays} day${b.rentalDays === 1 ? '' : 's'} · ${formatLkr(b.subtotal)} rental (deposit, fuel and extras settled with the provider)`,
  ];
}

function summaryHtml(b: BookingEmailBase): string {
  return `<table style="border-collapse:collapse;margin:12px 0;font-size:14px">
<tr><td style="padding:2px 12px 2px 0;color:#666">Booking</td><td><strong>${escapeHtml(b.reference)}</strong></td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Vehicle</td><td>${escapeHtml(b.vehicleTitle)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Pickup</td><td>${escapeHtml(formatColombo(b.startsAt))} (Sri Lanka time)</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Return</td><td>${escapeHtml(formatColombo(b.endsAt))}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Price</td><td>${b.rentalDays} day${b.rentalDays === 1 ? '' : 's'} · ${escapeHtml(formatLkr(b.subtotal))} rental</td></tr>
</table>
<p style="font-size:13px;color:#444">The refundable deposit, fuel, delivery and extra kilometres are settled with the provider in person. Nothing is paid online in this release.</p>`;
}

// ------------------------------------------------------------------ request

export function bookingRequestedProviderEmail(
  input: BookingEmailBase & {
    customerFirstName: string;
    respondBy: Date;
    customerNote: string | null;
  },
): EmailMessage {
  const subject = `New booking request ${input.reference}: ${input.vehicleTitle}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.customerFirstName} requested to book your vehicle.`,
    ...summaryText(input),
    ...(input.customerNote ? ['', `Customer note: ${input.customerNote}`] : []),
    '',
    `Please accept or decline by ${formatColombo(input.respondBy)} (Sri Lanka time); after that the request expires.`,
    'Accepting reserves the vehicle for these dates and declines other overlapping requests.',
    input.link,
  ].join('\n');
  const html = layout(
    'New booking request',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.customerFirstName)}</strong> requested to book your vehicle.</p>
${summaryHtml(input)}
${input.customerNote ? quote(input.customerNote) : ''}
<p>Please accept or decline by <strong>${escapeHtml(formatColombo(input.respondBy))}</strong> (Sri Lanka time); after that the request expires. Accepting reserves the vehicle for these dates and declines other overlapping requests.</p>
${button(input.link, 'Review request')}`,
  );
  return { to: input.to, subject, text, html };
}

export function bookingRequestReceivedEmail(
  input: BookingEmailBase & { providerName: string; respondBy: Date },
): EmailMessage {
  const subject = `We sent your request ${input.reference} to ${input.providerName}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your booking request was sent to ${input.providerName}.`,
    ...summaryText(input),
    '',
    `The provider has until ${formatColombo(input.respondBy)} (Sri Lanka time) to accept. The vehicle is not reserved until they do, and nothing is paid online in this release.`,
    input.link,
  ].join('\n');
  const html = layout(
    'Request sent',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your booking request was sent to <strong>${escapeHtml(input.providerName)}</strong>.</p>
${summaryHtml(input)}
<p>The provider has until <strong>${escapeHtml(formatColombo(input.respondBy))}</strong> (Sri Lanka time) to accept. The vehicle is not reserved until they do.</p>
${button(input.link, 'View request')}`,
  );
  return { to: input.to, subject, text, html };
}

// ------------------------------------------------------------- decisions

export function bookingAcceptedEmail(
  input: BookingEmailBase & { providerName: string; confirmBy: Date; providerNote: string | null },
): EmailMessage {
  const subject = `${input.providerName} accepted your request ${input.reference}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Good news: ${input.providerName} accepted your booking request and the vehicle is reserved for you.`,
    ...summaryText(input),
    ...(input.providerNote ? ['', `Message from the provider: ${input.providerNote}`] : []),
    '',
    `Next step: confirmation. Online payment is not available yet; the platform team confirms accepted bookings by ${formatColombo(input.confirmBy)} (Sri Lanka time). You will receive another e-mail once the booking is confirmed, with the pickup address and the provider's contact details.`,
    input.link,
  ].join('\n');
  const html = layout(
    'Request accepted',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Good news: <strong>${escapeHtml(input.providerName)}</strong> accepted your booking request and the vehicle is reserved for you.</p>
${summaryHtml(input)}
${input.providerNote ? quote(input.providerNote) : ''}
<p><strong>Next step: confirmation.</strong> Online payment is not available yet; the platform team confirms accepted bookings by ${escapeHtml(formatColombo(input.confirmBy))} (Sri Lanka time). You will receive another e-mail once the booking is confirmed, with the pickup address and the provider’s contact details.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function bookingDeclinedEmail(
  input: BookingEmailBase & {
    providerName: string;
    reasonLabel: string;
    note: string | null;
    automatic: boolean;
  },
): EmailMessage {
  const subject = `Your request ${input.reference} was not accepted`;
  const lead = input.automatic
    ? `The vehicle was booked by another customer for overlapping dates, so your request to ${input.providerName} was closed automatically.`
    : `${input.providerName} could not accept your booking request.`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    lead,
    ...summaryText(input),
    '',
    `Reason: ${input.reasonLabel}`,
    ...(input.note ? [`Note from the provider: ${input.note}`] : []),
    '',
    'You have not been charged. Search again to find another vehicle for your dates.',
    input.link,
  ].join('\n');
  const html = layout(
    'Request not accepted',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(lead)}</p>
${summaryHtml(input)}
<p>Reason: <strong>${escapeHtml(input.reasonLabel)}</strong></p>
${input.note ? quote(input.note) : ''}
<p>You have not been charged. Search again to find another vehicle for your dates.</p>
${button(input.link, 'View request')}`,
  );
  return { to: input.to, subject, text, html };
}

export function bookingRequestExpiredEmail(
  input: BookingEmailBase & { providerName: string },
): EmailMessage {
  const subject = `Your request ${input.reference} expired`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `We are sorry: ${input.providerName} did not respond in time, so your booking request expired.`,
    ...summaryText(input),
    '',
    'You have not been charged. Search again to find another vehicle for your dates.',
    input.link,
  ].join('\n');
  const html = layout(
    'Request expired',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We are sorry: <strong>${escapeHtml(input.providerName)}</strong> did not respond in time, so your booking request expired.</p>
${summaryHtml(input)}
<p>You have not been charged. Search again to find another vehicle for your dates.</p>
${button(input.link, 'Search again')}`,
  );
  return { to: input.to, subject, text, html };
}

/** Accepted but not confirmed before `confirmBy`; sent to both parties. */
export function bookingAcceptanceExpiredEmail(
  input: BookingEmailBase & { party: 'customer' | 'provider' },
): EmailMessage {
  const subject = `Booking ${input.reference} expired before confirmation`;
  const explanation =
    input.party === 'customer'
      ? 'The booking was accepted but not confirmed within the confirmation window, so the reservation was released. You have not been charged; you can send a new request if the dates are still free.'
      : 'The booking was accepted but not confirmed within the confirmation window, so the reservation on your vehicle was released and the dates are available again.';
  const text = [`Hi ${input.fullName},`, '', explanation, ...summaryText(input), input.link].join(
    '\n',
  );
  const html = layout(
    'Booking expired',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(explanation)}</p>
${summaryHtml(input)}
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

// ---------------------------------------------------------- confirmation

export function bookingConfirmedCustomerEmail(
  input: BookingEmailBase & {
    providerName: string;
    pickupAddress: string;
    pickupInstructions: string | null;
  },
): EmailMessage {
  const subject = `Booking ${input.reference} confirmed: ${input.vehicleTitle}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your booking with ${input.providerName} is confirmed.`,
    ...summaryText(input),
    '',
    `Pickup address: ${input.pickupAddress}`,
    ...(input.pickupInstructions ? [`Pickup instructions: ${input.pickupInstructions}`] : []),
    '',
    `The provider's phone number and e-mail are now visible on your booking page. Bring your driving licence and the deposit of the amount shown in the booking.`,
    input.link,
  ].join('\n');
  const html = layout(
    'Booking confirmed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your booking with <strong>${escapeHtml(input.providerName)}</strong> is confirmed.</p>
${summaryHtml(input)}
<p><strong>Pickup address:</strong> ${escapeHtml(input.pickupAddress)}</p>
${input.pickupInstructions ? `<p><strong>Pickup instructions:</strong> ${escapeHtml(input.pickupInstructions)}</p>` : ''}
<p>The provider’s phone number and e-mail are now visible on your booking page. Bring your driving licence and the deposit of the amount shown in the booking.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function bookingConfirmedProviderEmail(
  input: BookingEmailBase & { customerName: string },
): EmailMessage {
  const subject = `Booking ${input.reference} confirmed: ${input.vehicleTitle}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `The booking by ${input.customerName} is confirmed. The customer's contact details are now visible on the booking page.`,
    ...summaryText(input),
    '',
    'Record the pickup and the return on the booking page when they happen.',
    input.link,
  ].join('\n');
  const html = layout(
    'Booking confirmed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>The booking by <strong>${escapeHtml(input.customerName)}</strong> is confirmed. The customer’s contact details are now visible on the booking page.</p>
${summaryHtml(input)}
<p>Record the pickup and the return on the booking page when they happen.</p>
${button(input.link, 'Open booking')}`,
  );
  return { to: input.to, subject, text, html };
}

// ----------------------------------------------------------- cancellation

export function bookingCancelledEmail(
  input: BookingEmailBase & {
    cancelledBy: 'customer' | 'provider';
    counterpartName: string;
    note: string | null;
  },
): EmailMessage {
  const subject = `Booking ${input.reference} was cancelled`;
  const lead =
    input.cancelledBy === 'customer'
      ? `${input.counterpartName} cancelled this booking. The dates are available again.`
      : `${input.counterpartName} cancelled this booking. We are sorry for the inconvenience; you have not been charged.`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    lead,
    ...summaryText(input),
    ...(input.note ? ['', `Note: ${input.note}`] : []),
    input.link,
  ].join('\n');
  const html = layout(
    'Booking cancelled',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(lead)}</p>
${summaryHtml(input)}
${input.note ? quote(input.note) : ''}
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

// --------------------------------------------------------------- handover

export interface HandoverRecord {
  odometerKm: number | null;
  fuelLevel: number | null;
  note: string | null;
}

function recordLines(record: HandoverRecord): string[] {
  const lines: string[] = [];
  if (record.odometerKm !== null) lines.push(`Odometer: ${record.odometerKm} km`);
  if (record.fuelLevel !== null) lines.push(`Fuel: ${record.fuelLevel}/8`);
  if (record.note) lines.push(`Note: ${record.note}`);
  return lines.length > 0 ? lines : ['No readings were recorded.'];
}

export function bookingPickedUpEmail(
  input: BookingEmailBase & { providerName: string; record: HandoverRecord; pickedUpAt: Date },
): EmailMessage {
  const subject = `Pickup recorded for booking ${input.reference}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.providerName} recorded the handover of ${input.vehicleTitle} at ${formatColombo(input.pickedUpAt)} (Sri Lanka time). Keep this record; it protects both sides at return.`,
    ...recordLines(input.record),
    '',
    `Return by ${formatColombo(input.endsAt)}.`,
    input.link,
  ].join('\n');
  const html = layout(
    'Pickup recorded',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.providerName)}</strong> recorded the handover of ${escapeHtml(input.vehicleTitle)} at ${escapeHtml(formatColombo(input.pickedUpAt))} (Sri Lanka time). Keep this record; it protects both sides at return.</p>
<ul>${recordLines(input.record)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul>
<p>Return by <strong>${escapeHtml(formatColombo(input.endsAt))}</strong>.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function bookingCompletedEmail(
  input: BookingEmailBase & { providerName: string; record: HandoverRecord; completedAt: Date },
): EmailMessage {
  const subject = `Booking ${input.reference} completed`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.providerName} recorded the return of ${input.vehicleTitle} at ${formatColombo(input.completedAt)} (Sri Lanka time). Thank you for renting with ${APP_NAME}.`,
    ...recordLines(input.record),
    input.link,
  ].join('\n');
  const html = layout(
    'Rental completed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.providerName)}</strong> recorded the return of ${escapeHtml(input.vehicleTitle)} at ${escapeHtml(formatColombo(input.completedAt))} (Sri Lanka time). Thank you for renting with ${escapeHtml(APP_NAME)}.</p>
<ul>${recordLines(input.record)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}

export function bookingNoShowEmail(
  input: BookingEmailBase & { providerName: string },
): EmailMessage {
  const subject = `Booking ${input.reference} marked as no-show`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.providerName} recorded that the vehicle was not picked up and marked the booking as a no-show. The reservation has been released.`,
    ...summaryText(input),
    '',
    'If this is a mistake, reply to the platform team with your booking reference.',
    input.link,
  ].join('\n');
  const html = layout(
    'Marked as no-show',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.providerName)}</strong> recorded that the vehicle was not picked up and marked the booking as a no-show. The reservation has been released.</p>
${summaryHtml(input)}
<p>If this is a mistake, reply to the platform team with your booking reference.</p>
${button(input.link, 'View booking')}`,
  );
  return { to: input.to, subject, text, html };
}
