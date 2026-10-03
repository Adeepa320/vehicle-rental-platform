import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns } from './_types';

/**
 * Key/value platform configuration (commission rate, booking windows, search
 * radius, ...). Values are JSON so numbers, strings and booleans keep their type.
 * Seeds only insert missing keys; they never overwrite an admin's change.
 */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  description: text('description'),
  /** Admin user id once the users table exists (Phase 2); no FK yet. */
  updatedBy: uuid('updated_by'),
  ...auditColumns,
});

export type PlatformSetting = typeof platformSettings.$inferSelect;
export type NewPlatformSetting = typeof platformSettings.$inferInsert;
