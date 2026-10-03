import { boolean, pgTable, smallint, text } from 'drizzle-orm/pg-core';

import { auditColumns } from './_types';

/**
 * Vehicle categories are data, not code: adding one is an insert.
 * Inactive categories are hidden from customers and providers.
 */
export const vehicleCategories = pgTable('vehicle_categories', {
  /** Slug, e.g. `car`, `scooter`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameSi: text('name_si'),
  nameTa: text('name_ta'),
  icon: text('icon'),
  sortOrder: smallint('sort_order').notNull().default(0),
  /** Informational only: the Sri Lankan licence class customers are told they need. */
  requiresLicenceClass: text('requires_licence_class'),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
});

export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type NewVehicleCategory = typeof vehicleCategories.$inferInsert;
