import type { EmailMessage } from './email-provider';
import { APP_NAME, button, escapeHtml, layout, quote } from './templates';

export interface VehicleEmailBase {
  to: string;
  fullName: string;
  /** Listing title or "make model year" for sparse drafts. */
  title: string;
}

export function vehicleSubmittedEmail(input: VehicleEmailBase & { link: string }): EmailMessage {
  const subject = `We received your vehicle listing (${input.title})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your listing "${input.title}" was submitted for platform review.`,
    'Our team checks every listing manually and may contact you to confirm details.',
    'You can follow the status here:',
    input.link,
  ].join('\n');
  const html = layout(
    'Listing received',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your listing <strong>${escapeHtml(input.title)}</strong> was submitted for platform review.</p>
<p>Our team checks every listing manually and may contact you to confirm details.</p>
${button(input.link, 'View listing status')}`,
  );
  return { to: input.to, subject, text, html };
}

export function vehicleChangesRequestedEmail(
  input: VehicleEmailBase & { reason: string; link: string },
): EmailMessage {
  const subject = `Action needed on your vehicle listing (${input.title})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team reviewed "${input.title}" and needs a few changes before it can be approved:`,
    '',
    input.reason,
    '',
    'Update the listing and resubmit it here:',
    input.link,
  ].join('\n');
  const html = layout(
    'Changes requested',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team reviewed <strong>${escapeHtml(input.title)}</strong> and needs a few changes before it can be approved:</p>
${quote(input.reason)}
${button(input.link, 'Update and resubmit')}`,
  );
  return { to: input.to, subject, text, html };
}

export function vehicleApprovedEmail(input: VehicleEmailBase & { link: string }): EmailMessage {
  const subject = `${input.title} is approved on ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Good news: "${input.title}" has been approved by our team.`,
    'It is available unless you block dates in the availability calendar. Customer search and bookings open in a later release.',
    input.link,
  ].join('\n');
  const html = layout(
    'Listing approved',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Good news: <strong>${escapeHtml(input.title)}</strong> has been approved by our team.</p>
<p>It is available unless you block dates in the availability calendar. Customer search and bookings open in a later release.</p>
${button(input.link, 'Manage availability')}`,
  );
  return { to: input.to, subject, text, html };
}

export function vehicleRejectedEmail(input: VehicleEmailBase & { reason: string }): EmailMessage {
  const subject = `Update on your vehicle listing (${input.title})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `We could not approve "${input.title}":`,
    '',
    input.reason,
    '',
    'You can create a new listing once the issue is resolved.',
  ].join('\n');
  const html = layout(
    'Listing not approved',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>We could not approve <strong>${escapeHtml(input.title)}</strong>:</p>
${quote(input.reason)}
<p>You can create a new listing once the issue is resolved.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function vehicleSuspendedEmail(input: VehicleEmailBase & { reason: string }): EmailMessage {
  const subject = `${input.title} has been suspended on ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `"${input.title}" has been suspended and is no longer available:`,
    '',
    input.reason,
    '',
    'Reply to our team to resolve this.',
  ].join('\n');
  const html = layout(
    'Listing suspended',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p><strong>${escapeHtml(input.title)}</strong> has been suspended and is no longer available:</p>
${quote(input.reason)}
<p>Reply to our team to resolve this.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function vehicleReactivatedEmail(input: VehicleEmailBase & { link: string }): EmailMessage {
  const subject = `${input.title} is active again on ${APP_NAME}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `The suspension of "${input.title}" has been lifted. The listing is available again unless you block dates.`,
    input.link,
  ].join('\n');
  const html = layout(
    'Listing reactivated',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>The suspension of <strong>${escapeHtml(input.title)}</strong> has been lifted. The listing is available again unless you block dates.</p>
${button(input.link, 'Open listing')}`,
  );
  return { to: input.to, subject, text, html };
}

export interface OperatorNewVehicleInput {
  to: string;
  title: string;
  providerName: string;
  reviewLink: string;
}

/** Internal notice to the platform operator; contains only what the admin page shows anyway. */
export function operatorNewVehicleEmail(input: OperatorNewVehicleInput): EmailMessage {
  const subject = `New vehicle submitted: ${input.title}`;
  const text = [
    'A vehicle listing was submitted for review.',
    `Vehicle: ${input.title}`,
    `Provider: ${input.providerName}`,
    input.reviewLink,
  ].join('\n');
  const html = layout(
    'New vehicle listing',
    `<p>A vehicle listing was submitted for review.</p>
<p><strong>${escapeHtml(input.title)}</strong><br>${escapeHtml(input.providerName)}</p>
${button(input.reviewLink, 'Review listing')}`,
  );
  return { to: input.to, subject, text, html };
}
