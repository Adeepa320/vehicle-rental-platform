import type {
  BlockReason,
  FuelPolicy,
  FuelType,
  Transmission,
  VehicleStatus,
} from '@vrp/contracts';

import type { BadgeTone } from './provider-labels';

export const VEHICLE_STATUS: Record<
  VehicleStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  draft: {
    label: 'Draft',
    tone: 'outline',
    description: 'Complete the listing and submit it for review.',
  },
  submitted: {
    label: 'Submitted',
    tone: 'secondary',
    description: 'Waiting for platform review. The listing is locked until a decision is made.',
  },
  under_review: {
    label: 'Under review',
    tone: 'secondary',
    description: 'A member of our team is reviewing this listing.',
  },
  changes_requested: {
    label: 'Changes requested',
    tone: 'destructive',
    description: 'Please address the points below and resubmit.',
  },
  approved: {
    label: 'Approved',
    tone: 'default',
    description: 'Live. Available unless you block dates. Identity fields are now locked.',
  },
  rejected: {
    label: 'Not approved',
    tone: 'destructive',
    description: 'This listing was not approved. Create a new listing once the issue is resolved.',
  },
  inactive: {
    label: 'Inactive',
    tone: 'outline',
    description: 'Taken offline by you. Reactivate when the vehicle is ready again.',
  },
  suspended: {
    label: 'Suspended',
    tone: 'destructive',
    description: 'Suspended by the platform. It cannot become available until reactivated.',
  },
};

export const TRANSMISSION_LABEL: Record<Transmission, string> = {
  manual: 'Manual',
  automatic: 'Automatic',
};
export const FUEL_LABEL: Record<FuelType, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  hybrid: 'Hybrid',
  electric: 'Electric',
};
export const FUEL_POLICY_LABEL: Record<FuelPolicy, string> = {
  full_to_full: 'Full to full',
  same_to_same: 'Return at the same level',
  included: 'Fuel included',
};
export const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  maintenance: 'Maintenance / service',
  provider_unavailable: 'I am unavailable',
  rented_offline: 'Rented outside the platform',
  reserved_offline: 'Reserved outside the platform',
  other: 'Other',
};

/** Date-only display in Sri Lanka time, e.g. "12 Nov 2026". */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Colombo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** `YYYY-MM-DD` (as typed in a date input) → ISO instant at 00:00 Asia/Colombo. */
export function colomboDateToInstant(date: string): string {
  return `${date}T00:00:00+05:30`;
}

/** ISO instant → `YYYY-MM-DD` of that moment in Asia/Colombo. */
export function instantToColomboDate(instant: string): string {
  const shifted = new Date(new Date(instant).getTime() + 5.5 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Today's date in Asia/Colombo as `YYYY-MM-DD`. */
export function todayInColombo(): string {
  return instantToColomboDate(new Date().toISOString());
}

/** Listing title, or "make model year" for sparse drafts, or the fallback. */
export function vehicleTitle(
  v: { title: string | null; make: string | null; model: string | null; modelYear: number | null },
  fallback = 'Untitled draft',
): string {
  if (v.title) return v.title;
  const parts = [v.make, v.model, v.modelYear].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : fallback;
}
