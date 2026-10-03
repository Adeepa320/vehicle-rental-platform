import type { NewPlatformSetting } from '../../schema';

/**
 * Initial platform settings. Values marked "DEFAULT — pending business
 * decision" are placeholders from docs/DATABASE_DESIGN.md §6.12 and
 * docs/TECH_DECISIONS.md D8; they are configuration, not product decisions.
 * Seeding inserts missing keys only and never overwrites existing values.
 */
export const PLATFORM_SETTINGS: NewPlatformSetting[] = [
  {
    key: 'currency',
    value: 'LKR',
    description: 'Base currency for all prices and payments (ISO 4217).',
  },
  {
    key: 'default_commission_rate',
    value: 10,
    description:
      'Percent of the booking total retained by the platform. DEFAULT — pending business decision.',
  },
  {
    key: 'advance_percentage',
    value: 10,
    description:
      'Percent of the booking total paid online after acceptance. Equal to the commission in MVP (money model B, TECH_DECISIONS D8); raising it above the commission activates provider settlements.',
  },
  {
    key: 'provider_response_hours',
    value: 24,
    description: 'Hours a provider has to accept or decline a booking request.',
  },
  {
    key: 'payment_window_hours',
    value: 24,
    description:
      'Hours a customer has to pay the advance after acceptance (capped at pickup time).',
  },
  {
    key: 'no_show_grace_hours',
    value: 3,
    description: 'Hours after pickup time before a provider may mark a booking as no-show.',
  },
  {
    key: 'cancellation_full_refund_hours',
    value: 48,
    description:
      'Minimum hours before pickup for a full advance refund on customer cancellation. DEFAULT — pending business decision.',
  },
  {
    key: 'default_search_radius_km',
    value: 15,
    description:
      'Search radius used when a place has no default radius or the user searches from a point.',
  },
  {
    key: 'max_search_radius_km',
    value: 50,
    description: 'Upper bound a client may request for the search radius.',
  },
  {
    key: 'review_window_days',
    value: 14,
    description: 'Days after completion during which a customer may leave a review.',
  },
  {
    key: 'contact_reveal_stage',
    value: 'confirmed',
    description:
      'Booking status at which counterpart contact details are revealed: "accepted" or "confirmed". DEFAULT — pending product decision.',
  },
  {
    key: 'vehicle_review_required',
    value: true,
    description:
      'Whether a vehicle must pass admin document review before it can be active. DEFAULT — pending product decision.',
  },
  {
    key: 'auto_pause_on_document_expiry',
    value: true,
    description: 'Automatically pause a vehicle when its revenue licence or insurance expires.',
  },
];
