import { z } from 'zod';

import { IndicativeRatesSettingSchema } from '../common/currency';

/**
 * Typed platform settings (Phase 9, TECH_DECISIONS D63). Only the keys listed
 * here can be read or changed through the admin API, each with its own
 * schema; there is no "set any key to any JSON" route. The money pair
 * (`advance_percentage`, `default_commission_rate`) is validated together
 * because the Phase 7 money model (D8 model B) requires them to be equal while
 * no settlement ledger exists.
 */
export const SettingGroupSchema = z.enum([
  'booking',
  'cancellation',
  'search',
  'reviews_reminders',
  'documents',
  'money',
  'display_currency',
  'disputes',
]);
export type SettingGroup = z.infer<typeof SettingGroupSchema>;

const Hours = z
  .number()
  .min(0.25)
  .max(24 * 30);
const Grace = z.number().min(0).max(72);
const Days = z.number().int().min(1).max(90);
const Km = z.number().min(1).max(200);
/** Percent with at most two decimals, as a number (stored as JSON number). */
const Percent = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === v * 100, 'at most two decimals');

export interface SettingDefinition {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  description: string;
  /** Changing it needs a typed reason and shows a warning. */
  highImpact: boolean;
  /** Applies to new decisions only; existing bookings keep their snapshot. */
  schema: z.ZodType;
  /** Short hint of the accepted value for the UI. */
  hint: string;
}

export const SETTING_KEYS = [
  'provider_response_hours',
  'payment_window_hours',
  'no_show_grace_hours',
  'contact_reveal_stage',
  'cancellation_full_refund_hours',
  'default_search_radius_km',
  'max_search_radius_km',
  'review_window_days',
  'payment_reminder_hours_before',
  'pickup_reminder_hours_before',
  'review_reminder_days_after',
  'dispute_window_days',
  'auto_pause_on_document_expiry',
  'default_commission_rate',
  'advance_percentage',
  'indicative_exchange_rates',
] as const;
export const SettingKeySchema = z.enum(SETTING_KEYS);
export type SettingKey = z.infer<typeof SettingKeySchema>;

export const SETTING_DEFINITIONS: Readonly<Record<SettingKey, SettingDefinition>> = {
  provider_response_hours: {
    key: 'provider_response_hours',
    group: 'booking',
    label: 'Provider response window',
    description: 'Hours a provider has to accept or decline a new request before it expires.',
    highImpact: true,
    schema: Hours,
    hint: 'hours, 0.25–720',
  },
  payment_window_hours: {
    key: 'payment_window_hours',
    group: 'booking',
    label: 'Payment window',
    description:
      'Hours after acceptance the customer has to pay the advance before the hold is released (capped at pickup).',
    highImpact: true,
    schema: Hours,
    hint: 'hours, 0.25–720',
  },
  no_show_grace_hours: {
    key: 'no_show_grace_hours',
    group: 'booking',
    label: 'No-show grace period',
    description: 'Hours after the pickup time before a provider may record a no-show.',
    highImpact: false,
    schema: Grace,
    hint: 'hours, 0–72',
  },
  contact_reveal_stage: {
    key: 'contact_reveal_stage',
    group: 'booking',
    label: 'Contact reveal stage',
    description:
      'Booking status from which both parties can see each other’s contact details ("accepted" or "confirmed").',
    highImpact: true,
    schema: z.enum(['accepted', 'confirmed']),
    hint: 'accepted | confirmed',
  },
  cancellation_full_refund_hours: {
    key: 'cancellation_full_refund_hours',
    group: 'cancellation',
    label: 'Full-refund cancellation threshold',
    description:
      'Customer cancellations at least this many hours before pickup get the advance back in full; later cancellations forfeit it. Applies to cancellations made after the change.',
    highImpact: true,
    schema: Hours,
    hint: 'hours, 0.25–720',
  },
  default_search_radius_km: {
    key: 'default_search_radius_km',
    group: 'search',
    label: 'Default search radius',
    description: 'Radius used when a searched place has no radius of its own.',
    highImpact: false,
    schema: Km,
    hint: 'km, 1–200',
  },
  max_search_radius_km: {
    key: 'max_search_radius_km',
    group: 'search',
    label: 'Maximum search radius',
    description: 'Largest radius a client may request; larger values are clamped.',
    highImpact: false,
    schema: Km,
    hint: 'km, 1–200',
  },
  review_window_days: {
    key: 'review_window_days',
    group: 'reviews_reminders',
    label: 'Review window',
    description: 'Days after completion during which a customer may leave and edit a review.',
    highImpact: false,
    schema: Days,
    hint: 'days, 1–90',
  },
  payment_reminder_hours_before: {
    key: 'payment_reminder_hours_before',
    group: 'reviews_reminders',
    label: 'Payment reminder',
    description: 'Hours before the payment deadline at which the one payment reminder is sent.',
    highImpact: false,
    schema: Hours,
    hint: 'hours, 0.25–720',
  },
  pickup_reminder_hours_before: {
    key: 'pickup_reminder_hours_before',
    group: 'reviews_reminders',
    label: 'Pickup reminder',
    description: 'Hours before pickup at which both parties get the one pickup reminder.',
    highImpact: false,
    schema: Hours,
    hint: 'hours, 0.25–720',
  },
  review_reminder_days_after: {
    key: 'review_reminder_days_after',
    group: 'reviews_reminders',
    label: 'Review reminder',
    description: 'Days after completion at which a customer without a review gets one reminder.',
    highImpact: false,
    schema: Days,
    hint: 'days, 1–90',
  },
  dispute_window_days: {
    key: 'dispute_window_days',
    group: 'disputes',
    label: 'Dispute window',
    description:
      'Days after completion, no-show or cancellation during which a participant may open a dispute.',
    highImpact: false,
    schema: Days,
    hint: 'days, 1–90',
  },
  auto_pause_on_document_expiry: {
    key: 'auto_pause_on_document_expiry',
    group: 'documents',
    label: 'Auto-pause on document expiry',
    description:
      'When on, a listing whose approved revenue licence or insurance expires is paused (suspended) by the daily sweep until an admin reactivates it. Existing bookings are never cancelled.',
    highImpact: true,
    schema: z.boolean(),
    hint: 'true | false',
  },
  default_commission_rate: {
    key: 'default_commission_rate',
    group: 'money',
    label: 'Platform commission',
    description:
      'Percent of the rental subtotal the platform keeps. Coupled with the advance percentage: the online advance is the commission (money model B), so the platform never holds provider money.',
    highImpact: true,
    schema: Percent,
    hint: 'percent, 0–100',
  },
  advance_percentage: {
    key: 'advance_percentage',
    group: 'money',
    label: 'Online advance',
    description:
      'Percent of the rental subtotal paid online after acceptance. Must equal the commission while no settlement ledger exists. Applies to bookings requested after the change; existing bookings keep their snapshot.',
    highImpact: true,
    schema: Percent.pipe(z.number().min(1)),
    hint: 'percent, 1–100 (equal to the commission)',
  },
  indicative_exchange_rates: {
    key: 'indicative_exchange_rates',
    group: 'display_currency',
    label: 'Indicative exchange rates',
    description:
      'Operator-maintained LKR → foreign display rates (units of foreign currency per 1 LKR). Display only; never used for pricing or payment.',
    highImpact: false,
    schema: IndicativeRatesSettingSchema,
    hint: '{ asOf, source, rates: { USD, EUR, GBP, AUD } }',
  },
};

/** Keys whose values must stay equal while settlements are dormant (TECH_DECISIONS D8, D56). */
export const COUPLED_MONEY_SETTING_KEYS: readonly SettingKey[] = [
  'default_commission_rate',
  'advance_percentage',
];

export const AdminSettingSchema = z.object({
  key: SettingKeySchema,
  group: SettingGroupSchema,
  label: z.string(),
  description: z.string(),
  hint: z.string(),
  highImpact: z.boolean(),
  value: z.unknown(),
  /** Optimistic-concurrency token: send it back as `expectedUpdatedAt`. */
  updatedAt: z.iso.datetime(),
  updatedBy: z.uuid().nullable(),
});
export type AdminSetting = z.infer<typeof AdminSettingSchema>;

/** Read-only context the settings page shows next to the editable keys. */
export const AdminSettingsResponseSchema = z.object({
  data: z.array(AdminSettingSchema),
  readOnly: z.array(
    z.object({ key: z.string(), value: z.unknown(), description: z.string().nullable() }),
  ),
});
export type AdminSettingsResponse = z.infer<typeof AdminSettingsResponseSchema>;

export const SettingChangeSchema = z.strictObject({
  key: SettingKeySchema,
  value: z.unknown(),
  expectedUpdatedAt: z.iso.datetime(),
});
export type SettingChange = z.infer<typeof SettingChangeSchema>;

/** `PUT /admin/settings`: one transaction, every key validated, money pair checked on the result. */
export const UpdateSettingsRequestSchema = z
  .strictObject({
    changes: z.array(SettingChangeSchema).min(1).max(SETTING_KEYS.length),
    /** Required when any change touches a high-impact key. */
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .refine((v) => new Set(v.changes.map((c) => c.key)).size === v.changes.length, {
    path: ['changes'],
    message: 'each key may appear once',
  });
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
