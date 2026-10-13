/**
 * Provider-neutral SMS texts for the time-critical events of USER_FLOWS §4
 * (Phase 8, TECH_DECISIONS D58). **No SMS gateway is integrated**: these are
 * the messages the platform would send to +94 numbers once a sender id is
 * registered (Notify.lk / Text.lk, both deferred). They are kept short (one
 * GSM-7 segment where possible), carry only the booking reference, a time
 * and a plain link, and never contain names, phone numbers, amounts paid
 * online, or any token.
 */
export interface SmsMessage {
  /** E.164 destination. */
  to: string;
  text: string;
  templateKey: SmsTemplateKey;
}

export type SmsTemplateKey =
  | 'booking.requested'
  | 'booking.accepted'
  | 'booking.payment_reminder'
  | 'booking.confirmed'
  | 'booking.pickup_reminder'
  | 'booking.cancelled';

/** GSM-7 single segment; two segments at most for the longest template. */
export const SMS_SEGMENT_LENGTH = 160;

export const SMS_TEMPLATES: Record<
  SmsTemplateKey,
  (input: { reference: string; when?: string; link: string }) => string
> = {
  'booking.requested': ({ reference, when, link }) =>
    `New booking request ${reference}. Respond by ${when ?? 'the deadline'}: ${link}`,
  'booking.accepted': ({ reference, when, link }) =>
    `Request ${reference} accepted. Pay the advance by ${when ?? 'the deadline'} to confirm: ${link}`,
  'booking.payment_reminder': ({ reference, when, link }) =>
    `Reminder: booking ${reference} is held until ${when ?? 'the deadline'}. Pay the advance to confirm: ${link}`,
  'booking.confirmed': ({ reference, link }) =>
    `Booking ${reference} is confirmed. Pickup details and contact: ${link}`,
  'booking.pickup_reminder': ({ reference, when, link }) =>
    `Reminder: pickup for booking ${reference} is ${when ?? 'soon'}. Details: ${link}`,
  'booking.cancelled': ({ reference, link }) =>
    `Booking ${reference} was cancelled. Details: ${link}`,
};

export function renderSms(
  key: SmsTemplateKey,
  to: string,
  input: { reference: string; when?: string; link: string },
): SmsMessage {
  return { to, text: SMS_TEMPLATES[key](input), templateKey: key };
}
