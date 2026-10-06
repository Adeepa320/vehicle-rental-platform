import {
  DECLINE_REASON_LABEL,
  ProviderDeclineReasonSchema,
  type BookingPaymentState,
  type BookingStatus,
  type PaymentAnomaly,
  type PaymentStatus,
  type ProviderDeclineReason,
} from '@vrp/contracts';

import type { BadgeTone } from './provider-labels';

export { DECLINE_REASON_LABEL };

/** Status wording per audience (USER_FLOWS §1.5, §2.5). */
export const BOOKING_STATUS: Record<
  BookingStatus,
  { label: string; tone: BadgeTone; customer: string; provider: string }
> = {
  requested: {
    label: 'Requested',
    tone: 'secondary',
    customer:
      'Waiting for the provider to accept. The vehicle is not reserved yet and nothing has been paid.',
    provider: 'A customer is waiting for your answer. Accept to reserve the vehicle, or decline.',
  },
  accepted: {
    label: 'Accepted',
    tone: 'default',
    customer:
      'The provider accepted and the vehicle is reserved for you. Pay the advance online by the deadline to confirm the booking.',
    provider:
      'You accepted; the dates are reserved on your calendar. The booking is confirmed once the customer pays the advance online.',
  },
  confirmed: {
    label: 'Confirmed',
    tone: 'default',
    customer:
      'Your booking is confirmed. Pickup details and the provider’s contact are shown below.',
    provider: 'Confirmed. Record the handover when the customer picks the vehicle up.',
  },
  active: {
    label: 'In progress',
    tone: 'default',
    customer: 'The rental is in progress. The provider records the return at the end.',
    provider: 'The customer has the vehicle. Record the return when it comes back.',
  },
  completed: {
    label: 'Completed',
    tone: 'outline',
    customer: 'The rental is complete. Thank you!',
    provider: 'The rental is complete.',
  },
  declined: {
    label: 'Not accepted',
    tone: 'destructive',
    customer: 'The provider could not accept this request. You have not been charged.',
    provider: 'This request was declined.',
  },
  expired: {
    label: 'Expired',
    tone: 'outline',
    customer: 'This request expired without a confirmation. You have not been charged.',
    provider: 'This request expired.',
  },
  cancelled_by_customer: {
    label: 'Cancelled by customer',
    tone: 'outline',
    customer: 'You cancelled this booking.',
    provider: 'The customer cancelled this booking; the dates are free again.',
  },
  cancelled_by_provider: {
    label: 'Cancelled by provider',
    tone: 'destructive',
    customer: 'The provider cancelled this booking. We are sorry; you have not been charged.',
    provider: 'You cancelled this booking.',
  },
  no_show: {
    label: 'No-show',
    tone: 'destructive',
    customer: 'The provider recorded that the vehicle was not picked up.',
    provider: 'Recorded as a no-show; the dates are free again.',
  },
};

export const PROVIDER_DECLINE_REASONS: { value: ProviderDeclineReason; label: string }[] =
  ProviderDeclineReasonSchema.options.map((value) => ({
    value,
    label: DECLINE_REASON_LABEL[value],
  }));

/** Fuel gauge in eighths. */
export const FUEL_LEVEL_LABEL: Record<number, string> = {
  0: 'Empty',
  1: '1/8',
  2: '1/4',
  3: '3/8',
  4: '1/2',
  5: '5/8',
  6: '3/4',
  7: '7/8',
  8: 'Full',
};

/** Timeline wording for `booking_events` actions. */
export const EVENT_LABEL: Record<string, string> = {
  'booking.requested': 'Request sent',
  'booking.accepted': 'Accepted by the provider',
  'booking.declined': 'Not accepted',
  'booking.expired': 'Expired',
  'booking.confirmed': 'Confirmed',
  'booking.cancelled': 'Cancelled',
  'booking.picked_up': 'Pickup recorded',
  'booking.completed': 'Return recorded',
  'booking.no_show': 'Marked as no-show',
  'booking.contact_revealed': 'Contact details viewed',
};

/** Wording for the advance payment state (customer and provider pages). */
export const PAYMENT_STATE: Record<
  BookingPaymentState,
  { label: string; tone: BadgeTone; customer: string; provider: string }
> = {
  not_started: {
    label: 'Advance not paid',
    tone: 'outline',
    customer: 'Pay the advance online to confirm the booking.',
    provider: 'Awaiting the customer’s advance.',
  },
  pending: {
    label: 'Payment in progress',
    tone: 'secondary',
    customer: 'A payment was started. If you did not complete it, you can try again.',
    provider: 'The customer started paying the advance.',
  },
  paid: {
    label: 'Advance paid',
    tone: 'default',
    customer: 'The advance was received; the booking is confirmed.',
    provider: 'Advance received by the platform; the booking is confirmed.',
  },
  failed: {
    label: 'Payment failed',
    tone: 'destructive',
    customer: 'The last payment attempt failed. Nothing was charged; you can try again.',
    provider: 'The customer’s last payment attempt failed.',
  },
  cancelled: {
    label: 'Payment cancelled',
    tone: 'outline',
    customer: 'The last payment attempt was cancelled before it completed. You can try again.',
    provider: 'The customer cancelled the last payment attempt.',
  },
  refund_due: {
    label: 'Refund due',
    tone: 'secondary',
    customer: 'The advance will be refunded; our team processes refunds manually.',
    provider: 'The advance is being refunded to the customer by the platform.',
  },
  forfeited: {
    label: 'Advance not refundable',
    tone: 'outline',
    customer:
      'The booking was cancelled too close to pickup, so under the cancellation policy the advance is not refunded.',
    provider: 'The customer cancelled close to pickup; the advance is not refunded.',
  },
  refunded: {
    label: 'Advance refunded',
    tone: 'outline',
    customer: 'The advance has been refunded.',
    provider: 'The advance was refunded to the customer.',
  },
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const PAYMENT_ANOMALY_LABEL: Record<PaymentAnomaly, string> = {
  amount_mismatch: 'Amount did not match the booking',
  currency_mismatch: 'Currency did not match the booking',
  late_success: 'Paid after the booking had closed',
  duplicate_payment: 'Paid twice for the same booking',
  chargeback: 'Chargeback reported by the gateway',
  refund_due: 'Refund due after cancellation',
};

/** Date and time in Sri Lanka time, e.g. "12 Nov 2026, 09:00". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Colombo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
