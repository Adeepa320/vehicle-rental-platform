import type { EmailMessage } from './email-provider';
import { APP_NAME, button, escapeHtml, layout, quote } from './templates';

/**
 * E-mails sent by Phase 9 admin operations: account standing, document
 * review and expiry, listing moderation and disputes. Operator-written
 * reasons are escaped in HTML and quoted verbatim in plain text; nothing
 * here carries ids beyond booking references, and never contact details of
 * the other party.
 */

interface Base {
  to: string;
  fullName: string;
}

// ------------------------------------------------------------- accounts

export function accountSuspendedEmail(input: Base & { reason: string }): EmailMessage {
  const subject = `Your ${APP_NAME} account has been suspended`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'Your account has been suspended by the platform team and you have been signed out everywhere:',
    '',
    input.reason,
    '',
    'Existing bookings are not cancelled by this. Reply to our team if you believe this is a mistake.',
  ].join('\n');
  const html = layout(
    'Account suspended',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your account has been suspended by the platform team and you have been signed out everywhere:</p>
${quote(input.reason)}
<p>Existing bookings are not cancelled by this. Reply to our team if you believe this is a mistake.</p>`,
  );
  return { to: input.to, subject, text, html };
}

export function accountReactivatedEmail(input: Base & { link: string }): EmailMessage {
  const subject = `Your ${APP_NAME} account is active again`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'The suspension of your account has been lifted. You can sign in again.',
    input.link,
  ].join('\n');
  const html = layout(
    'Account reactivated',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>The suspension of your account has been lifted. You can sign in again.</p>
${button(input.link, 'Sign in')}`,
  );
  return { to: input.to, subject, text, html };
}

export function accountAnonymisedEmail(input: Base): EmailMessage {
  const subject = `Your ${APP_NAME} account has been closed`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    'Your account has been closed and your personal details removed from your profile.',
    'Booking and payment records are kept without your name, as required for accounting and dispute history.',
    'This address will not receive further messages from us.',
  ].join('\n');
  const html = layout(
    'Account closed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your account has been closed and your personal details removed from your profile.</p>
<p>Booking and payment records are kept without your name, as required for accounting and dispute history.</p>
<p>This address will not receive further messages from us.</p>`,
  );
  return { to: input.to, subject, text, html };
}

// ------------------------------------------------------------ documents

export interface DocumentEmailBase extends Base {
  /** e.g. "Revenue licence" plus the vehicle label when it is a vehicle document. */
  documentLabel: string;
  link: string;
}

export function documentApprovedEmail(
  input: DocumentEmailBase & { expiresOn: string | null },
): EmailMessage {
  const subject = `${input.documentLabel} approved`;
  const expiry = input.expiresOn ? `It is valid until ${input.expiresOn}.` : '';
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team reviewed and approved your ${input.documentLabel}. ${expiry}`.trim(),
    input.link,
  ].join('\n');
  const html = layout(
    'Document approved',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team reviewed and approved your <strong>${escapeHtml(input.documentLabel)}</strong>. ${escapeHtml(expiry)}</p>
${button(input.link, 'View documents')}`,
  );
  return { to: input.to, subject, text, html };
}

export function documentRejectedEmail(input: DocumentEmailBase & { reason: string }): EmailMessage {
  const subject = `${input.documentLabel} could not be approved`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team could not approve your ${input.documentLabel}:`,
    '',
    input.reason,
    '',
    'Upload a clear, complete replacement here:',
    input.link,
  ].join('\n');
  const html = layout(
    'Document not approved',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team could not approve your <strong>${escapeHtml(input.documentLabel)}</strong>:</p>
${quote(input.reason)}
${button(input.link, 'Upload a replacement')}`,
  );
  return { to: input.to, subject, text, html };
}

export function documentReplacementRequestedEmail(
  input: DocumentEmailBase & { reason: string },
): EmailMessage {
  const subject = `Please upload a new ${input.documentLabel}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team needs a new version of your ${input.documentLabel}:`,
    '',
    input.reason,
    '',
    'The current document stays valid until the replacement is reviewed. Upload it here:',
    input.link,
  ].join('\n');
  const html = layout(
    'New document needed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team needs a new version of your <strong>${escapeHtml(input.documentLabel)}</strong>:</p>
${quote(input.reason)}
<p>The current document stays valid until the replacement is reviewed.</p>
${button(input.link, 'Upload a replacement')}`,
  );
  return { to: input.to, subject, text, html };
}

export function documentExpiringEmail(
  input: DocumentEmailBase & { expiresOn: string; daysLeft: number; autoPause: boolean },
): EmailMessage {
  const when =
    input.daysLeft <= 0 ? 'today' : `in ${input.daysLeft} day${input.daysLeft === 1 ? '' : 's'}`;
  const subject = `${input.documentLabel} expires ${when} (${input.expiresOn})`;
  const consequence = input.autoPause
    ? 'When it expires the listing is paused automatically until a new document is approved.'
    : 'When it expires the "Verified vehicle" badge is removed until a new document is approved.';
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your ${input.documentLabel} expires ${when}, on ${input.expiresOn}.`,
    consequence,
    'Upload the renewed document here:',
    input.link,
  ].join('\n');
  const html = layout(
    'Document expiring',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your <strong>${escapeHtml(input.documentLabel)}</strong> expires ${escapeHtml(when)}, on ${escapeHtml(input.expiresOn)}.</p>
<p>${escapeHtml(consequence)}</p>
${button(input.link, 'Upload the renewed document')}`,
  );
  return { to: input.to, subject, text, html };
}

export function documentExpiredEmail(
  input: DocumentEmailBase & { expiresOn: string; listingPaused: boolean },
): EmailMessage {
  const subject = `${input.documentLabel} expired on ${input.expiresOn}`;
  const consequence = input.listingPaused
    ? 'The listing has been paused and is no longer shown to customers. Existing bookings are not affected. Upload the renewed document; once approved, our team reactivates the listing.'
    : 'The "Verified vehicle" badge has been removed. Upload the renewed document to restore it.';
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Your ${input.documentLabel} expired on ${input.expiresOn}.`,
    consequence,
    input.link,
  ].join('\n');
  const html = layout(
    'Document expired',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Your <strong>${escapeHtml(input.documentLabel)}</strong> expired on ${escapeHtml(input.expiresOn)}.</p>
<p>${escapeHtml(consequence)}</p>
${button(input.link, 'Upload the renewed document')}`,
  );
  return { to: input.to, subject, text, html };
}

// ------------------------------------------------------------- listings

export function vehiclePhotoRemovedEmail(
  input: Base & {
    title: string;
    reason: string;
    remainingPhotos: number;
    minimumPhotos: number;
    link: string;
  },
): EmailMessage {
  const subject = `A photo was removed from your listing (${input.title})`;
  const below = input.remainingPhotos < input.minimumPhotos;
  const consequence = below
    ? `The listing now has ${input.remainingPhotos} photo${input.remainingPhotos === 1 ? '' : 's'}; it needs at least ${input.minimumPhotos} to appear in search. Upload a replacement to make it visible again.`
    : `The listing still has ${input.remainingPhotos} photos and remains visible.`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team removed a photo from "${input.title}":`,
    '',
    input.reason,
    '',
    consequence,
    input.link,
  ].join('\n');
  const html = layout(
    'Photo removed',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team removed a photo from <strong>${escapeHtml(input.title)}</strong>:</p>
${quote(input.reason)}
<p>${escapeHtml(consequence)}</p>
${button(input.link, 'Open listing')}`,
  );
  return { to: input.to, subject, text, html };
}

export function vehicleCategoryCorrectedEmail(
  input: Base & {
    title: string;
    fromCategory: string;
    toCategory: string;
    reason: string;
    link: string;
  },
): EmailMessage {
  const subject = `Category of your listing corrected (${input.title})`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `Our team moved "${input.title}" from the ${input.fromCategory} category to ${input.toCategory}:`,
    '',
    input.reason,
    '',
    input.link,
  ].join('\n');
  const html = layout(
    'Listing category corrected',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>Our team moved <strong>${escapeHtml(input.title)}</strong> from the ${escapeHtml(input.fromCategory)} category to <strong>${escapeHtml(input.toCategory)}</strong>:</p>
${quote(input.reason)}
${button(input.link, 'Open listing')}`,
  );
  return { to: input.to, subject, text, html };
}

// -------------------------------------------------------------- disputes

export interface DisputeEmailBase extends Base {
  reference: string;
  vehicleTitle: string;
  link: string;
}

export function disputeOpenedEmail(
  input: DisputeEmailBase & { openedBy: 'customer' | 'provider'; reasonLabel: string },
): EmailMessage {
  const subject = `A dispute was opened on booking ${input.reference}`;
  const who = input.openedBy === 'customer' ? 'The customer' : 'The provider';
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${who} opened a dispute on booking ${input.reference} (${input.vehicleTitle}): ${input.reasonLabel}.`,
    'You can read their description and reply on the dispute page. The platform team reviews every dispute and records a decision there.',
    input.link,
  ].join('\n');
  const html = layout(
    'Dispute opened',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(who)} opened a dispute on booking <strong>${escapeHtml(input.reference)}</strong> (${escapeHtml(input.vehicleTitle)}): ${escapeHtml(input.reasonLabel)}.</p>
<p>You can read their description and reply on the dispute page. The platform team reviews every dispute and records a decision there.</p>
${button(input.link, 'Open dispute')}`,
  );
  return { to: input.to, subject, text, html };
}

export function disputeMessageEmail(
  input: DisputeEmailBase & { authorLabel: string; body: string },
): EmailMessage {
  const subject = `New message in the dispute on booking ${input.reference}`;
  const text = [
    `Hi ${input.fullName},`,
    '',
    `${input.authorLabel} wrote in the dispute on booking ${input.reference}:`,
    '',
    input.body,
    '',
    input.link,
  ].join('\n');
  const html = layout(
    'New dispute message',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(input.authorLabel)} wrote in the dispute on booking <strong>${escapeHtml(input.reference)}</strong>:</p>
${quote(input.body)}
${button(input.link, 'Open dispute')}`,
  );
  return { to: input.to, subject, text, html };
}

export function disputeDecidedEmail(
  input: DisputeEmailBase & {
    outcome: 'resolved' | 'rejected';
    resolutionLabel: string | null;
    publicNote: string;
  },
): EmailMessage {
  const subject =
    input.outcome === 'resolved'
      ? `The dispute on booking ${input.reference} has been resolved`
      : `The dispute on booking ${input.reference} was not upheld`;
  const lead =
    input.outcome === 'resolved'
      ? `The platform team resolved the dispute on booking ${input.reference}${input.resolutionLabel ? ` (${input.resolutionLabel})` : ''}:`
      : `The platform team reviewed the dispute on booking ${input.reference} and did not uphold it:`;
  const text = [`Hi ${input.fullName},`, '', lead, '', input.publicNote, '', input.link].join('\n');
  const html = layout(
    input.outcome === 'resolved' ? 'Dispute resolved' : 'Dispute decision',
    `<p>Hi ${escapeHtml(input.fullName)},</p>
<p>${escapeHtml(lead)}</p>
${quote(input.publicNote)}
${button(input.link, 'Open dispute')}`,
  );
  return { to: input.to, subject, text, html };
}

export function operatorDisputeOpenedEmail(input: {
  to: string;
  reference: string;
  openedBy: 'customer' | 'provider';
  reasonLabel: string;
  link: string;
}): EmailMessage {
  const subject = `[Ops] Dispute opened on ${input.reference} (${input.reasonLabel})`;
  const text = [
    `A ${input.openedBy} opened a dispute on booking ${input.reference}: ${input.reasonLabel}.`,
    input.link,
  ].join('\n');
  return { to: input.to, subject, text };
}
