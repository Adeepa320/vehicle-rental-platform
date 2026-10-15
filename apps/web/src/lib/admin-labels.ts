import {
  DISPUTE_REASON_LABEL,
  DISPUTE_RESOLUTION_LABEL,
  type AdminCancellationActor,
  type AnonymisationBlocker,
  type AuditActorType,
  type DisputeStatus,
  type DocumentEffectiveStatus,
  type DocumentType,
  type PlaceKindSchema,
  type ProviderDocumentType,
  type ResendTemplate,
  type SettingGroup,
  type UserStatus,
  type VehicleDocumentType,
} from '@vrp/contracts';
import type { z } from 'zod';

import type { BadgeTone } from './provider-labels';

type PlaceKind = z.infer<typeof PlaceKindSchema>;

export { DISPUTE_REASON_LABEL, DISPUTE_RESOLUTION_LABEL };

/** Wording for private verification documents (Phase 9). */
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  identity_document: 'Identity document',
  business_registration: 'Business registration',
  other: 'Other document',
  certificate_of_registration: 'Certificate of registration',
  revenue_licence: 'Revenue licence',
  insurance_certificate: 'Insurance certificate',
  emission_certificate: 'Emission certificate',
};

export const PROVIDER_DOCUMENT_TYPES: readonly ProviderDocumentType[] = [
  'identity_document',
  'business_registration',
  'other',
];
export const VEHICLE_DOCUMENT_TYPES: readonly VehicleDocumentType[] = [
  'certificate_of_registration',
  'revenue_licence',
  'insurance_certificate',
  'emission_certificate',
];

export const DOCUMENT_STATUS: Record<
  DocumentEffectiveStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  pending: {
    label: 'Awaiting review',
    tone: 'secondary',
    description: 'Uploaded; the platform team has not reviewed it yet.',
  },
  approved: {
    label: 'Approved',
    tone: 'default',
    description: 'Reviewed and approved by the platform team.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'destructive',
    description: 'Not accepted; see the reason and upload a replacement.',
  },
  expired: {
    label: 'Expired',
    tone: 'destructive',
    description: 'Approved, but the expiry date has passed. Upload the renewed document.',
  },
  superseded: {
    label: 'Replaced',
    tone: 'outline',
    description: 'A newer upload of the same type replaced this one.',
  },
};

export const DISPUTE_STATUS: Record<
  DisputeStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  open: {
    label: 'Open',
    tone: 'secondary',
    description: 'Waiting for the platform team to start the review.',
  },
  in_review: {
    label: 'In review',
    tone: 'default',
    description: 'The platform team is looking into it; you can still add messages.',
  },
  resolved: {
    label: 'Resolved',
    tone: 'outline',
    description: 'The platform team recorded a decision.',
  },
  rejected: {
    label: 'Not upheld',
    tone: 'destructive',
    description: 'The platform team did not uphold this dispute.',
  },
};

export const SETTING_GROUP_LABEL: Record<SettingGroup, string> = {
  booking: 'Booking windows',
  cancellation: 'Cancellation',
  search: 'Search',
  reviews_reminders: 'Reviews and reminders',
  documents: 'Documents',
  money: 'Money (coupled pair)',
  display_currency: 'Display currency',
  disputes: 'Disputes',
};

export const USER_STATUS: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'default' },
  suspended: { label: 'Suspended', tone: 'destructive' },
  deleted: { label: 'Anonymised', tone: 'outline' },
};

export const ANONYMISATION_BLOCKER_LABEL: Record<AnonymisationBlocker, string> = {
  open_booking_as_customer: 'Has an open booking as a customer',
  open_booking_as_provider: 'Has an open booking on one of their vehicles',
  open_dispute: 'Is a party to an open dispute',
  unresolved_payment: 'Has a payment awaiting manual resolution',
  refund_due: 'Is owed a refund that has not been recorded',
  privileged_account: 'Holds an admin role (remove it first)',
  already_anonymised: 'Already anonymised',
};

export const RESEND_TEMPLATE_LABEL: Record<ResendTemplate, string> = {
  booking_confirmation: 'Booking confirmation',
  payment_reminder: 'Payment reminder',
  pickup_reminder: 'Pickup reminder',
  cancellation_notice: 'Cancellation notice',
  review_request: 'Review request',
};

export const CANCELLATION_ACTOR_LABEL: Record<AdminCancellationActor, string> = {
  customer: 'On behalf of the customer (customer rules apply)',
  provider: 'On behalf of the provider (full refund)',
  platform: 'By the platform (full refund)',
};

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  city: 'City',
  town: 'Town',
  area: 'Area',
  landmark: 'Landmark',
  airport: 'Airport',
};

export const AUDIT_ACTOR_LABEL: Record<AuditActorType, string> = {
  admin: 'Admin',
  provider: 'Provider',
  customer: 'Customer',
  system: 'System',
};

/** `YYYY-MM-DD` of the day `offsetDays` from today in Asia/Colombo. */
export function colomboDayOffset(offsetDays: number): string {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000 + 5.5 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Compact one-line JSON for metadata cells. */
export function compactJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
