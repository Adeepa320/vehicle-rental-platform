import { MIN_VEHICLE_PHOTOS } from '@vrp/contracts';
import {
  providerLocations,
  providerProfiles,
  vehicleCategories,
  vehiclePhotos,
  vehicles,
} from '@vrp/database';
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

/**
 * Everything a listing must satisfy to be visible to customers and bookable
 * (TECH_DECISIONS D44): approved with a slug, active provider, active pickup
 * location, active category and at least `MIN_VEHICLE_PHOTOS` photos. Used by
 * public search, the public vehicle page, quotes and booking creation, so the
 * four can never disagree. Callers must join `provider_profiles`,
 * `provider_locations` and `vehicle_categories` to `vehicles`.
 */
export function searchableCondition(): SQL {
  return and(
    eq(vehicles.status, 'approved'),
    isNull(vehicles.deletedAt),
    isNotNull(vehicles.slug),
    eq(providerProfiles.status, 'active'),
    isNull(providerProfiles.deletedAt),
    eq(providerLocations.isActive, true),
    eq(vehicleCategories.isActive, true),
    sql`(select count(*) from ${vehiclePhotos} ph where ph.vehicle_id = ${vehicles.id} and ph.deleted_at is null) >= ${MIN_VEHICLE_PHOTOS}`,
  ) as SQL;
}
