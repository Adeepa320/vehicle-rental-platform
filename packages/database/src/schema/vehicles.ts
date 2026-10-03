import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns, geographyPoint } from './_types';
import { districts } from './districts';
import { places } from './places';
import { providerProfiles } from './providers';
import { users } from './users';
import { vehicleCategories } from './vehicle-categories';

const tz = { withTimezone: true } as const;
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

export const transmission = pgEnum('transmission', ['manual', 'automatic']);
export const fuelType = pgEnum('fuel_type', ['petrol', 'diesel', 'hybrid', 'electric']);
export const fuelPolicy = pgEnum('fuel_policy', ['full_to_full', 'same_to_same', 'included']);
/** Listing lifecycle and review state in one enum (TECH_DECISIONS D38). */
export const vehicleStatus = pgEnum('vehicle_status', [
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'inactive',
  'suspended',
]);
export const holdKind = pgEnum('hold_kind', ['booking', 'block']);
export const blockReason = pgEnum('block_reason', [
  'maintenance',
  'provider_unavailable',
  'rented_offline',
  'reserved_offline',
  'other',
]);

/**
 * A provider's pickup / operating base (design table `locations`). The pin is
 * optional in Phase 4 (district + gazetteer place are required; no paid map or
 * geocoding API). Deactivated locations are kept for history.
 */
export const providerLocations = pgTable(
  'provider_locations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    districtId: text('district_id')
      .notNull()
      .references(() => districts.id),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id),
    addressText: text('address_text').notNull(),
    /** Precise pin; exposed publicly only rounded (SECURITY_AND_PRIVACY §13). */
    geom: geographyPoint('geom'),
    pickupInstructions: text('pickup_instructions'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: timestamp('deactivated_at', tz),
    ...auditColumns,
  },
  (t) => [
    index('provider_locations_provider_id_idx').on(t.providerId),
    index('provider_locations_place_id_idx').on(t.placeId),
    uniqueIndex('provider_locations_one_primary_key')
      .on(t.providerId)
      .where(sql`${t.isPrimary} = true`),
    index('provider_locations_geom_gix').using('gist', t.geom),
  ],
);

export type ProviderLocation = typeof providerLocations.$inferSelect;
export type NewProviderLocation = typeof providerLocations.$inferInsert;

/**
 * Vehicle listings. Nullable while `draft`; completeness is enforced at
 * submission by the contracts (`vehicleSubmissionIssues`). Money columns are
 * `numeric(12,2)` in LKR (no floats). No photos/documents in Phase 4.
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => providerLocations.id),
    categoryId: text('category_id')
      .notNull()
      .references(() => vehicleCategories.id),
    status: vehicleStatus('status').notNull().default('draft'),
    /** Public URL slug (`toyota-aqua-2018-mirissa-ab12`); generated on first approval (TECH_DECISIONS D45). */
    slug: text('slug'),

    title: text('title'),
    internalName: text('internal_name'),
    make: text('make'),
    model: text('model'),
    modelYear: smallint('model_year'),
    transmission: transmission('transmission'),
    fuelType: fuelType('fuel_type'),
    seats: smallint('seats'),
    doors: smallint('doors'),
    luggageCapacity: smallint('luggage_capacity'),
    engineCc: smallint('engine_cc'),
    hasAc: boolean('has_ac').notNull().default(false),
    color: text('color'),
    /** Upper-cased plate; never rendered publicly (masked helper in contracts). */
    registrationNumber: text('registration_number'),
    description: text('description'),

    currency: text('currency').notNull().default('LKR'),
    dailyRate: money('daily_rate'),
    weeklyRate: money('weekly_rate'),
    monthlyRate: money('monthly_rate'),
    securityDeposit: money('security_deposit'),
    /** NULL = unlimited. */
    includedKmPerDay: integer('included_km_per_day'),
    extraKmRate: money('extra_km_rate'),
    minRentalDays: smallint('min_rental_days').notNull().default(1),
    maxRentalDays: smallint('max_rental_days'),

    minRenterAge: smallint('min_renter_age'),
    minLicenceYears: smallint('min_licence_years'),
    fuelPolicy: fuelPolicy('fuel_policy'),
    deliveryAvailable: boolean('delivery_available').notNull().default(false),
    deliveryFee: money('delivery_fee'),
    pickupNotes: text('pickup_notes'),

    submittedAt: timestamp('submitted_at', tz),
    reviewStartedAt: timestamp('review_started_at', tz),
    changesRequestedAt: timestamp('changes_requested_at', tz),
    approvedAt: timestamp('approved_at', tz),
    rejectedAt: timestamp('rejected_at', tz),
    deactivatedAt: timestamp('deactivated_at', tz),
    suspendedAt: timestamp('suspended_at', tz),
    /** Last admin decision of any kind. */
    reviewedAt: timestamp('reviewed_at', tz),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Shown to the provider (changes requested / rejection). */
    reviewReason: text('review_reason'),
    suspensionReason: text('suspension_reason'),
    /** Internal, admin-only. */
    adminNotes: text('admin_notes'),
    ...auditColumns,
    deletedAt: timestamp('deleted_at', tz),
  },
  (t) => [
    index('vehicles_provider_id_idx').on(t.providerId),
    index('vehicles_location_id_idx').on(t.locationId),
    index('vehicles_category_id_idx').on(t.categoryId),
    index('vehicles_status_idx').on(t.status, t.submittedAt),
    uniqueIndex('vehicles_slug_key')
      .on(t.slug)
      .where(sql`${t.slug} is not null`),
    uniqueIndex('vehicles_provider_registration_key')
      .on(t.providerId, t.registrationNumber)
      .where(sql`${t.deletedAt} is null`),
    check('vehicles_daily_rate_positive', sql`${t.dailyRate} is null or ${t.dailyRate} > 0`),
    check('vehicles_min_rental_days_check', sql`${t.minRentalDays} >= 1`),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type VehicleStatus = (typeof vehicleStatus.enumValues)[number];

/**
 * Single source of truth for unavailability (DATABASE_DESIGN §6.6). Phase 4
 * writes only `kind = 'block'` rows (provider manual blocks); booking holds and
 * the `booking_id` foreign key arrive with the booking phase. The period is the
 * half-open `[starts_at, ends_at)`; a custom migration adds the exclusion
 * constraint `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)`
 * so overlapping holds are impossible regardless of code path (TECH_DECISIONS D14).
 */
export const vehicleHolds = pgTable(
  'vehicle_holds',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', tz).notNull(),
    endsAt: timestamp('ends_at', tz).notNull(),
    kind: holdKind('kind').notNull(),
    /** Foreign key to `bookings` is added when that table exists. */
    bookingId: uuid('booking_id'),
    blockReason: blockReason('block_reason'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_holds_vehicle_period_idx').on(t.vehicleId, t.startsAt, t.endsAt),
    check('vehicle_holds_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'vehicle_holds_kind_consistency',
      sql`(${t.kind} = 'booking') = (${t.bookingId} is not null) and (${t.kind} = 'block') = (${t.blockReason} is not null)`,
    ),
  ],
);

export type VehicleHold = typeof vehicleHolds.$inferSelect;
export type NewVehicleHold = typeof vehicleHolds.$inferInsert;
export type HoldKind = (typeof holdKind.enumValues)[number];
export type BlockReason = (typeof blockReason.enumValues)[number];
