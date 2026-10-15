import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { districts } from './districts';
import { places } from './places';
import { vehicleCategories } from './vehicle-categories';

const tz = { withTimezone: true } as const;

/**
 * Privacy-safe demand log (Phase 9, DATABASE_DESIGN §12 `search_logs`,
 * TECH_DECISIONS D64): one row per first-page public search with the
 * normalised criteria and the number of results returned. Never an IP, a user
 * id, a session, free text or exact coordinates: searches are keyed to the
 * gazetteer place / district / category only. Written best-effort after the
 * results are computed; a failed insert never fails the search.
 */
export const searchLogs = pgTable(
  'search_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    districtId: text('district_id').references(() => districts.id, { onDelete: 'set null' }),
    categoryId: text('category_id').references(() => vehicleCategories.id, {
      onDelete: 'set null',
    }),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    /** Safe filter summary: transmission, fuel, seats, AC, delivery, price bounds, sort, radius. */
    filters: jsonb('filters').$type<Record<string, unknown>>(),
    /** Results on the first page (0 = zero-result search). */
    resultCount: integer('result_count').notNull(),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [
    index('search_logs_created_idx').on(t.createdAt),
    index('search_logs_place_idx').on(t.placeId, t.createdAt),
    index('search_logs_category_idx').on(t.categoryId, t.createdAt),
    index('search_logs_zero_result_idx')
      .on(t.createdAt)
      .where(sql`${t.resultCount} = 0`),
  ],
);

export type SearchLogRow = typeof searchLogs.$inferSelect;
export type NewSearchLogRow = typeof searchLogs.$inferInsert;
