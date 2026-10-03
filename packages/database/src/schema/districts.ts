import { boolean, pgTable, smallint, text } from 'drizzle-orm/pg-core';

import { auditColumns } from './_types';

/**
 * Sri Lanka's 25 administrative districts. `is_active` gates where providers
 * may create pickup locations (phased geographic rollout).
 */
export const districts = pgTable('districts', {
  /** Slug, e.g. `matara`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  province: text('province').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  sortOrder: smallint('sort_order').notNull().default(0),
  ...auditColumns,
});

export type District = typeof districts.$inferSelect;
export type NewDistrict = typeof districts.$inferInsert;
