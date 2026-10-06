import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { auditColumns } from './_types';
import { providerProfiles } from './providers';
import { users } from './users';
import { providerLocations, vehicles } from './vehicles';

const tz = { withTimezone: true } as const;
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** Lifecycle from USER_FLOWS §0 (TECH_DECISIONS D12). */
export const bookingStatus = pgEnum('booking_status', [
  'requested',
  'accepted',
  'confirmed',
  'active',
  'completed',
  'declined',
  'expired',
  'cancelled_by_customer',
  'cancelled_by_provider',
  'no_show',
]);
export const declineReason = pgEnum('decline_reason', [
  'vehicle_unavailable',
  'requirements_not_met',
  'schedule_conflict',
  'other',
  'vehicle_no_longer_available',
]);

/**
 * Booking requests and their lifecycle (DATABASE_DESIGN §6.7, lean Phase 6).
 * A `requested` row never blocks the vehicle; the exclusive `vehicle_holds`
 * row is inserted by the accept transaction (§7.3) and released on
 * expiry / cancellation / no-show. Prices are an immutable snapshot taken at
 * request time (`numeric`, never floats); `version` backs optimistic
 * concurrency (`409 STALE_VERSION`). Payment columns arrive in Phase 7.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Human-readable code shown to both parties, e.g. `SLR-7F3K2Q`. */
    reference: text('reference').notNull(),
    customerUserId: uuid('customer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    /** Pickup location at request time (the vehicle's location then). */
    locationId: uuid('location_id')
      .notNull()
      .references(() => providerLocations.id, { onDelete: 'cascade' }),
    status: bookingStatus('status').notNull().default('requested'),
    version: integer('version').notNull().default(1),

    startsAt: timestamp('starts_at', tz).notNull(),
    endsAt: timestamp('ends_at', tz).notNull(),
    rentalDays: smallint('rental_days').notNull(),
    customerNote: text('customer_note'),
    providerNote: text('provider_note'),

    // ---- price snapshot (never recomputed from the vehicle) ----
    currency: text('currency').notNull().default('LKR'),
    priceBasis: text('price_basis').notNull(),
    dailyRate: money('daily_rate').notNull(),
    weeklyRate: money('weekly_rate'),
    monthlyRate: money('monthly_rate'),
    subtotalAmount: money('subtotal_amount').notNull(),
    securityDepositAmount: money('security_deposit_amount').notNull(),
    includedKmPerDay: integer('included_km_per_day'),
    extraKmRate: money('extra_km_rate'),
    /** The `lines` shown to both parties, as computed at request time. */
    priceBreakdown: jsonb('price_breakdown').$type<unknown>().notNull(),
    /** Hash of the vehicle's pricing fields when quoted; lets a stale quote be detected. */
    pricingFingerprint: text('pricing_fingerprint').notNull(),
    /** Money split snapshot (Phase 7, D8 model B): advance paid online, balance paid to the provider at pickup. */
    advancePercentage: numeric('advance_percentage', { precision: 5, scale: 2 })
      .notNull()
      .default('10.00'),
    advanceAmount: money('advance_amount').notNull().default('0.00'),
    balanceDueAmount: money('balance_due_amount').notNull().default('0.00'),

    // ---- timers ----
    respondBy: timestamp('respond_by', tz).notNull(),
    /** Set on acceptance: confirmation (payment, Phase 7) deadline after which the hold is released. */
    confirmBy: timestamp('confirm_by', tz),

    // ---- lifecycle timestamps ----
    acceptedAt: timestamp('accepted_at', tz),
    confirmedAt: timestamp('confirmed_at', tz),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    /** `admin_testing` until online payment exists. */
    confirmationSource: text('confirmation_source'),
    pickedUpAt: timestamp('picked_up_at', tz),
    completedAt: timestamp('completed_at', tz),
    declinedAt: timestamp('declined_at', tz),
    declineReason: declineReason('decline_reason'),
    declineNote: text('decline_note'),
    expiredAt: timestamp('expired_at', tz),
    cancelledAt: timestamp('cancelled_at', tz),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    cancellationNote: text('cancellation_note'),
    noShowAt: timestamp('no_show_at', tz),
    noShowNote: text('no_show_note'),

    // ---- handover records ----
    pickupOdometerKm: integer('pickup_odometer_km'),
    /** Eighths of a tank, 0–8. */
    pickupFuelLevel: smallint('pickup_fuel_level'),
    pickupNote: text('pickup_note'),
    returnOdometerKm: integer('return_odometer_km'),
    returnFuelLevel: smallint('return_fuel_level'),
    returnNote: text('return_note'),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('bookings_reference_key').on(t.reference),
    index('bookings_customer_idx').on(t.customerUserId, t.createdAt),
    index('bookings_provider_status_idx').on(t.providerId, t.status, t.startsAt),
    index('bookings_vehicle_period_idx').on(t.vehicleId, t.startsAt),
    index('bookings_respond_by_idx')
      .on(t.respondBy)
      .where(sql`${t.status} = 'requested'`),
    index('bookings_confirm_by_idx')
      .on(t.confirmBy)
      .where(sql`${t.status} = 'accepted'`),
    check('bookings_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('bookings_rental_days_check', sql`${t.rentalDays} >= 1`),
    check('bookings_version_check', sql`${t.version} >= 1`),
    check(
      'bookings_amounts_check',
      sql`${t.subtotalAmount} >= 0 and ${t.securityDepositAmount} >= 0 and ${t.dailyRate} > 0`,
    ),
    check(
      'bookings_fuel_levels_check',
      sql`(${t.pickupFuelLevel} is null or ${t.pickupFuelLevel} between 0 and 8) and (${t.returnFuelLevel} is null or ${t.returnFuelLevel} between 0 and 8)`,
    ),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingStatus = (typeof bookingStatus.enumValues)[number];
export type DeclineReason = (typeof declineReason.enumValues)[number];

/**
 * Driver details given for one booking (snapshot; one row per booking in
 * Phase 6). Deliberately minimal: no licence number, no documents
 * (SECURITY_AND_PRIVACY §6) — the provider checks the physical licence.
 */
export const bookingDrivers = pgTable(
  'booking_drivers',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    countryCode: text('country_code'),
    licenceCountry: text('licence_country').notNull(),
    licenceExpiresOn: date('licence_expires_on').notNull(),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('booking_drivers_booking_id_key').on(t.bookingId)],
);

export type BookingDriver = typeof bookingDrivers.$inferSelect;
export type NewBookingDriver = typeof bookingDrivers.$inferInsert;

/**
 * Append-only timeline of a booking (DATABASE_DESIGN §6.7). Written in the
 * same transaction as the change it records; a trigger forbids UPDATE.
 */
export const bookingEvents = pgTable(
  'booking_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    /** `customer` | `provider` | `admin` | `system` */
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Dotted verb, e.g. `booking.requested`, `booking.accepted`, `booking.contact_revealed`. */
    action: text('action').notNull(),
    fromStatus: bookingStatus('from_status'),
    toStatus: bookingStatus('to_status'),
    /** Safe details only (reason codes, hold id, counts); never contact data or free text. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [index('booking_events_booking_idx').on(t.bookingId, t.createdAt)],
);

export type BookingEvent = typeof bookingEvents.$inferSelect;
export type NewBookingEvent = typeof bookingEvents.$inferInsert;

/**
 * `Idempotency-Key` registry for `POST /bookings`, scoped per customer. The
 * row is inserted first inside the create transaction (`ON CONFLICT DO
 * NOTHING`), so a concurrent duplicate waits for the first transaction and
 * then finds the existing booking.
 */
export const bookingIdempotencyKeys = pgTable(
  'booking_idempotency_keys',
  {
    customerUserId: uuid('customer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** SHA-256 of the canonical request body; a different body with the same key is a conflict. */
    requestHash: text('request_hash').notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerUserId, t.key] })],
);

export type BookingIdempotencyKey = typeof bookingIdempotencyKeys.$inferSelect;
