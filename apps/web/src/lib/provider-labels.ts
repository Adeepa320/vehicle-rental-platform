import type { ProviderApplicationStatus, ProviderStatus, ProviderType } from '@vrp/contracts';

export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline';

export const APPLICATION_STATUS: Record<
  ProviderApplicationStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  draft: {
    label: 'Draft',
    tone: 'outline',
    description: 'Complete the form and submit it when you are ready.',
  },
  submitted: {
    label: 'Submitted',
    tone: 'secondary',
    description:
      'Your application is in the review queue. Our team may call or e-mail you to confirm details.',
  },
  under_review: {
    label: 'Under review',
    tone: 'secondary',
    description: 'A member of our team is reviewing your application.',
  },
  changes_requested: {
    label: 'Changes requested',
    tone: 'destructive',
    description: 'Please address the points below, then resubmit.',
  },
  approved: {
    label: 'Approved',
    tone: 'default',
    description: 'You are a platform-approved provider.',
  },
  rejected: {
    label: 'Not approved',
    tone: 'destructive',
    description: 'This application was not approved.',
  },
};

export const PROVIDER_STATUS: Record<ProviderStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Platform-approved provider', tone: 'default' },
  suspended: { label: 'Suspended', tone: 'destructive' },
};

export const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = {
  individual: 'Individual owner',
  registered_business: 'Registered business',
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
}
