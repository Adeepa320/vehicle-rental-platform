import type {
  AnonymisationBlocker,
  PrivacyRequestStatus,
  PrivacyRequestType,
} from '@vrp/contracts';

import type { BadgeTone } from './provider-labels';

/** Wording for data-subject requests (Phase 10, TECH_DECISIONS D69). */
export const PRIVACY_REQUEST_TYPE_LABEL: Record<PrivacyRequestType, string> = {
  access: 'Copy of my data',
  deletion: 'Account deletion',
};

export const PRIVACY_REQUEST_STATUS: Record<
  PrivacyRequestStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  open: {
    label: 'Received',
    tone: 'secondary',
    description: 'We have your request; the platform team has not started on it yet.',
  },
  in_review: {
    label: 'In progress',
    tone: 'default',
    description: 'The platform team is working on your request.',
  },
  completed: {
    label: 'Completed',
    tone: 'outline',
    description: 'Done. Any note from the team is shown below.',
  },
  rejected: {
    label: 'Not actioned',
    tone: 'destructive',
    description: 'We could not action this request; the reason is shown below.',
  },
};

/** What currently prevents deletion, explained to the account holder in plain words. */
export const PRIVACY_BLOCKER_EXPLANATION: Record<AnonymisationBlocker, string> = {
  open_booking_as_customer:
    'You have a booking that is not finished yet. Deletion can go ahead once it is completed or cancelled.',
  open_booking_as_provider:
    'One of your vehicles has a booking that is not finished yet. Deletion can go ahead once it ends.',
  open_dispute: 'A dispute involving you is still open and must be closed first.',
  unresolved_payment: 'A payment on one of your bookings is still being resolved by our team.',
  refund_due: 'A refund owed to you has not been recorded yet; we complete that before deleting.',
  privileged_account: 'Your account holds an administrator role, which has to be removed first.',
  already_anonymised: 'This account has already been anonymised.',
};
