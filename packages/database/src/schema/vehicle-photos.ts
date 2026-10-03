import { sql } from 'drizzle-orm';
import { index, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';
import { vehicles } from './vehicles';

const tz = { withTimezone: true } as const;

/**
 * Listing photos (TECH_DECISIONS D43). One row per uploaded image: the
 * original lives under `storage_key` in the private bucket; the WebP variants
 * live under `public_prefix/{thumb,medium,large}.webp` in the public bucket
 * and are the only objects ever exposed. Purpose-built instead of the generic
 * `file_objects` registry (DATABASE_DESIGN §6.11), which arrives when a second
 * kind of file exists. Rows are soft-deleted; objects are removed best-effort.
 */
export const vehiclePhotos = pgTable(
  'vehicle_photos',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    /** Original object key in the private bucket (server-generated, never client-supplied). */
    storageKey: text('storage_key').notNull(),
    /** Key prefix of the public variants, e.g. `vehicles/<vehicleId>/<photoId>`. */
    publicPrefix: text('public_prefix').notNull(),
    /** Sniffed format of the original (`image/jpeg`, `image/png`, `image/webp`). */
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** 0 = primary photo. */
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', tz),
  },
  (t) => [
    index('vehicle_photos_vehicle_order_idx')
      .on(t.vehicleId, t.sortOrder)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type VehiclePhoto = typeof vehiclePhotos.$inferSelect;
export type NewVehiclePhoto = typeof vehiclePhotos.$inferInsert;
