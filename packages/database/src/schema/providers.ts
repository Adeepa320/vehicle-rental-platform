import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
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
import { districts } from './districts';
import { places } from './places';
import { users } from './users';
import { vehicleCategories } from './vehicle-categories';

export const providerType = pgEnum('provider_type', ['individual', 'registered_business']);
export const providerApplicationStatus = pgEnum('provider_application_status', [
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
]);
export const providerStatus = pgEnum('provider_status', ['active', 'suspended']);

const tz = { withTimezone: true } as const;

/**
 * One application per user. Fields are nullable while in `draft`; completeness
 * is enforced by the service at submission. The platform operator reviews
 * applications manually/offline in this phase (no document uploads): the
 * review columns record who decided what and why, nothing more.
 */
export const providerApplications = pgTable(
  'provider_applications',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: providerApplicationStatus('status').notNull().default('draft'),

    displayName: text('display_name'),
    providerType: providerType('provider_type'),
    contactName: text('contact_name'),
    phoneE164: text('phone_e164'),
    whatsappE164: text('whatsapp_e164'),
    addressText: text('address_text'),
    districtId: text('district_id').references(() => districts.id),
    primaryPlaceId: uuid('primary_place_id').references(() => places.id),
    serviceAreaPlaceIds: uuid('service_area_place_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    description: text('description'),
    yearsOperating: smallint('years_operating'),
    vehicleCategoryIds: text('vehicle_category_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    fleetSizeEstimate: smallint('fleet_size_estimate'),
    offersDelivery: boolean('offers_delivery').notNull().default(false),
    offersAirportTransfer: boolean('offers_airport_transfer').notNull().default(false),
    websiteUrl: text('website_url'),
    applicantNotes: text('applicant_notes'),

    agreementAcceptedAt: timestamp('agreement_accepted_at', tz),
    agreementVersion: text('agreement_version'),

    submittedAt: timestamp('submitted_at', tz),
    reviewStartedAt: timestamp('review_started_at', tz),
    changesRequestedAt: timestamp('changes_requested_at', tz),
    approvedAt: timestamp('approved_at', tz),
    rejectedAt: timestamp('rejected_at', tz),
    /** Last admin decision of any kind. */
    reviewedAt: timestamp('reviewed_at', tz),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Shown to the applicant (changes requested / rejection). */
    reviewReason: text('review_reason'),
    /** Internal, admin-only. */
    adminNotes: text('admin_notes'),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('provider_applications_user_id_key').on(t.userId),
    index('provider_applications_status_idx').on(t.status, t.submittedAt),
  ],
);

export type ProviderApplication = typeof providerApplications.$inferSelect;
export type NewProviderApplication = typeof providerApplications.$inferInsert;
export type ProviderApplicationStatus = (typeof providerApplicationStatus.enumValues)[number];
export type ProviderType = (typeof providerType.enumValues)[number];

/**
 * Created atomically when an application is approved. `status` is the
 * provider's current standing; the `provider` role on `users` is the
 * capability and is not removed on suspension (provider-only actions check
 * `status = 'active'`).
 */
export const providerProfiles = pgTable(
  'provider_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => providerApplications.id),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    providerType: providerType('provider_type').notNull(),
    contactName: text('contact_name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    /** Stays NULL until a real verification mechanism exists (later phase). */
    phoneVerifiedAt: timestamp('phone_verified_at', tz),
    whatsappE164: text('whatsapp_e164'),
    description: text('description'),
    addressText: text('address_text').notNull(),
    districtId: text('district_id')
      .notNull()
      .references(() => districts.id),
    primaryPlaceId: uuid('primary_place_id')
      .notNull()
      .references(() => places.id),
    yearsOperating: smallint('years_operating'),
    fleetSizeEstimate: smallint('fleet_size_estimate'),
    offersDelivery: boolean('offers_delivery').notNull().default(false),
    offersAirportTransfer: boolean('offers_airport_transfer').notNull().default(false),
    websiteUrl: text('website_url'),
    status: providerStatus('status').notNull().default('active'),
    approvedAt: timestamp('approved_at', tz).notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    suspendedAt: timestamp('suspended_at', tz),
    suspendedBy: uuid('suspended_by').references(() => users.id, { onDelete: 'set null' }),
    suspensionReason: text('suspension_reason'),
    reactivatedAt: timestamp('reactivated_at', tz),
    ...auditColumns,
    deletedAt: timestamp('deleted_at', tz),
  },
  (t) => [
    uniqueIndex('provider_profiles_user_id_key').on(t.userId),
    uniqueIndex('provider_profiles_application_id_key').on(t.applicationId),
    uniqueIndex('provider_profiles_slug_key').on(t.slug),
    index('provider_profiles_status_idx').on(t.status),
    index('provider_profiles_district_id_idx').on(t.districtId),
    index('provider_profiles_primary_place_id_idx').on(t.primaryPlaceId),
  ],
);

export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type NewProviderProfile = typeof providerProfiles.$inferInsert;
export type ProviderStatus = (typeof providerStatus.enumValues)[number];

/** Additional places a provider serves (queryable for later search). */
export const providerServiceAreas = pgTable(
  'provider_service_areas',
  {
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.placeId] })],
);

/** Vehicle categories a provider offers. */
export const providerVehicleCategories = pgTable(
  'provider_vehicle_categories',
  {
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerProfiles.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => vehicleCategories.id),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.categoryId] })],
);
