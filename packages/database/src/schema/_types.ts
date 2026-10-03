import { sql, type SQL } from 'drizzle-orm';
import { customType, timestamp } from 'drizzle-orm/pg-core';

import { parseEwkbPoint, type GeoPoint } from '../geo/ewkb';

/**
 * PostGIS `geography(Point, 4326)` column. Values are `{ lat, lng }` in
 * TypeScript; writes go through `ST_MakePoint(lng, lat)` and reads parse the
 * EWKB hex that PostgreSQL returns. Spatial predicates (`ST_DWithin`,
 * `ST_Distance`) are written as `sql` fragments in repositories.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(value: GeoPoint): SQL {
    return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`;
  },
  fromDriver(value: string): GeoPoint {
    return parseEwkbPoint(value);
  },
});

/** Standard audit columns. `updated_at` is maintained by the `set_updated_at` trigger. */
export const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
