import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { auditColumns, geographyPoint } from './_types';
import { districts } from './districts';

export const placeKind = pgEnum('place_kind', ['city', 'town', 'area', 'landmark', 'airport']);

/**
 * Curated gazetteer of towns, areas and landmarks used for search suggestions
 * and as search centres. Seeded for the launch region first (see seed data).
 */
export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    nameSi: text('name_si'),
    nameTa: text('name_ta'),
    /** Alternative spellings matched by the suggest endpoint. */
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    kind: placeKind('kind').notNull(),
    districtId: text('district_id')
      .notNull()
      .references(() => districts.id),
    /** e.g. Unawatuna -> Galle. */
    parentId: uuid('parent_id').references((): AnyPgColumn => places.id),
    /** Centre point used for radius search. */
    geom: geographyPoint('geom').notNull(),
    /** Search radius (km) applied when this place is selected. */
    defaultRadiusKm: numeric('default_radius_km', { precision: 5, scale: 1 })
      .notNull()
      .default('15.0'),
    isLaunchArea: boolean('is_launch_area').notNull().default(false),
    searchRank: smallint('search_rank').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('places_slug_key').on(t.slug),
    index('places_district_id_idx').on(t.districtId),
    index('places_geom_gix').using('gist', t.geom),
  ],
);

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;
