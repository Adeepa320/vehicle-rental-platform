import { eq, sql } from 'drizzle-orm';

import { createDatabase, type Database } from '../client';
import { loadRootEnv, requireEnv } from '../env';
import { districts, places, platformSettings, vehicleCategories } from '../schema';
import { DISTRICTS } from './data/districts';
import { PLACES } from './data/places';
import { PLATFORM_SETTINGS } from './data/platform-settings';
import { VEHICLE_CATEGORIES } from './data/vehicle-categories';

export interface SeedSummary {
  districts: number;
  places: number;
  vehicleCategories: number;
  /** Settings inserted in this run (existing keys are left untouched). */
  platformSettingsInserted: number;
}

/**
 * Idempotent reference-data seed.
 *
 * Policy:
 * - Reference attributes (names, coordinates, ordering, aliases) are upserted
 *   so corrections in the seed files propagate on re-run.
 * - Operational flags (`is_active`, `is_launch_area` excepted) and platform
 *   settings are insert-only: an admin's change in the database wins.
 */
export async function runSeed(db: Database): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    await tx
      .insert(districts)
      .values(DISTRICTS)
      .onConflictDoUpdate({
        target: districts.id,
        set: {
          name: sql`excluded.name`,
          province: sql`excluded.province`,
          sortOrder: sql`excluded.sort_order`,
        },
      });

    // Pass 1: all places without parents (parents may appear later in the list).
    await tx
      .insert(places)
      .values(
        PLACES.map((p) => ({
          slug: p.slug,
          name: p.name,
          nameSi: p.nameSi ?? null,
          nameTa: p.nameTa ?? null,
          aliases: p.aliases ?? [],
          kind: p.kind,
          districtId: p.districtId,
          geom: p.geom,
          defaultRadiusKm: p.defaultRadiusKm.toFixed(1),
          isLaunchArea: p.isLaunchArea,
          searchRank: p.searchRank,
        })),
      )
      .onConflictDoUpdate({
        target: places.slug,
        set: {
          name: sql`excluded.name`,
          nameSi: sql`excluded.name_si`,
          nameTa: sql`excluded.name_ta`,
          aliases: sql`excluded.aliases`,
          kind: sql`excluded.kind`,
          districtId: sql`excluded.district_id`,
          geom: sql`excluded.geom`,
          defaultRadiusKm: sql`excluded.default_radius_km`,
          isLaunchArea: sql`excluded.is_launch_area`,
          searchRank: sql`excluded.search_rank`,
        },
      });

    // Pass 2: resolve parent slugs to ids.
    const rows = await tx.select({ id: places.id, slug: places.slug }).from(places);
    const idBySlug = new Map(rows.map((r) => [r.slug, r.id] as const));
    for (const p of PLACES) {
      const parentId = p.parentSlug ? (idBySlug.get(p.parentSlug) ?? null) : null;
      if (p.parentSlug && !parentId) {
        throw new Error(`Seed error: parent place "${p.parentSlug}" for "${p.slug}" not found`);
      }
      await tx.update(places).set({ parentId }).where(eq(places.slug, p.slug));
    }

    await tx
      .insert(vehicleCategories)
      .values(VEHICLE_CATEGORIES)
      .onConflictDoUpdate({
        target: vehicleCategories.id,
        set: {
          name: sql`excluded.name`,
          nameSi: sql`excluded.name_si`,
          nameTa: sql`excluded.name_ta`,
          icon: sql`excluded.icon`,
          sortOrder: sql`excluded.sort_order`,
          requiresLicenceClass: sql`excluded.requires_licence_class`,
        },
      });

    const insertedSettings = await tx
      .insert(platformSettings)
      .values(PLATFORM_SETTINGS)
      .onConflictDoNothing({ target: platformSettings.key })
      .returning({ key: platformSettings.key });

    return {
      districts: DISTRICTS.length,
      places: PLACES.length,
      vehicleCategories: VEHICLE_CATEGORIES.length,
      platformSettingsInserted: insertedSettings.length,
    };
  });
}

if (require.main === module) {
  loadRootEnv();
  const handle = createDatabase({
    url: requireEnv('DATABASE_URL'),
    max: 2,
    applicationName: 'vehicle-rental-seed',
  });
  runSeed(handle.db)
    .then((summary) => {
      console.warn(
        `Seed complete: ${summary.districts} districts, ${summary.places} places, ` +
          `${summary.vehicleCategories} vehicle categories, ` +
          `${summary.platformSettingsInserted} new platform settings`,
      );
    })
    .catch((error: unknown) => {
      console.error('Seed failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => handle.close());
}
