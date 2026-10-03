import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseHandle } from '../client';
import { runMigrations } from '../migrate';
import { districts, places, platformSettings, vehicleCategories } from '../schema';
import { runSeed } from '../seed';
import { PLATFORM_SETTINGS } from '../seed/data/platform-settings';

const url = process.env.DATABASE_URL_TEST;
if (!url) {
  console.warn('DATABASE_URL_TEST is not set: skipping database integration tests');
}

describe.skipIf(!url)('database foundation (integration)', () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    await runMigrations(url as string);
    handle = createDatabase({ url: url as string, max: 2, applicationName: 'vrp-db-test' });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('installs the extensions the design depends on', async () => {
    const rows = await handle.sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('postgis', 'btree_gist', 'citext')
    `;
    expect(rows.map((r) => r.extname).sort()).toEqual(['btree_gist', 'citext', 'postgis']);
  });

  it('seeds reference data and is idempotent', async () => {
    const first = await runSeed(handle.db);
    const second = await runSeed(handle.db);
    expect(second.districts).toBe(first.districts);
    expect(second.platformSettingsInserted).toBe(0);

    const allDistricts = await handle.db.select().from(districts);
    expect(allDistricts).toHaveLength(25);
    expect(
      allDistricts
        .filter((d) => d.isActive)
        .map((d) => d.id)
        .sort(),
    ).toEqual(['galle', 'matara']);

    const launch = await handle.db
      .select({ slug: places.slug })
      .from(places)
      .where(eq(places.isLaunchArea, true));
    const launchSlugs = launch.map((p) => p.slug);
    for (const slug of ['matara', 'weligama', 'mirissa', 'galle', 'unawatuna']) {
      expect(launchSlugs).toContain(slug);
    }

    const [unawatuna] = await handle.db.select().from(places).where(eq(places.slug, 'unawatuna'));
    const [galle] = await handle.db.select().from(places).where(eq(places.slug, 'galle'));
    expect(unawatuna?.parentId).toBe(galle?.id);

    const categories = await handle.db.select().from(vehicleCategories);
    expect(categories.map((c) => c.id).sort()).toEqual(
      ['bike', 'car', 'scooter', 'suv', 'tuktuk', 'van'].sort(),
    );
    expect(categories.find((c) => c.id === 'scooter')?.isActive).toBe(false);
    expect(categories.find((c) => c.id === 'tuktuk')?.isActive).toBe(false);

    const settings = await handle.db.select().from(platformSettings);
    expect(settings.map((s) => s.key).sort()).toEqual(PLATFORM_SETTINGS.map((s) => s.key).sort());
  });

  it('never overwrites operational changes on re-seed', async () => {
    await handle.db
      .update(platformSettings)
      .set({ value: 12 })
      .where(eq(platformSettings.key, 'default_commission_rate'));
    await handle.db
      .update(vehicleCategories)
      .set({ isActive: true })
      .where(eq(vehicleCategories.id, 'scooter'));

    await runSeed(handle.db);

    const [setting] = await handle.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'default_commission_rate'));
    expect(setting?.value).toBe(12);
    const [scooter] = await handle.db
      .select()
      .from(vehicleCategories)
      .where(eq(vehicleCategories.id, 'scooter'));
    expect(scooter?.isActive).toBe(true);

    // Restore seed values so the test database stays canonical.
    await handle.db
      .update(platformSettings)
      .set({ value: 10 })
      .where(eq(platformSettings.key, 'default_commission_rate'));
    await handle.db
      .update(vehicleCategories)
      .set({ isActive: false })
      .where(eq(vehicleCategories.id, 'scooter'));
  });

  it('round-trips geography through the custom column type', async () => {
    const [mirissa] = await handle.db.select().from(places).where(eq(places.slug, 'mirissa'));
    expect(mirissa?.geom.lat).toBeCloseTo(5.9483, 4);
    expect(mirissa?.geom.lng).toBeCloseTo(80.4716, 4);
  });

  it('answers a PostGIS great-circle distance query using the GiST-indexed column', async () => {
    const [row] = await handle.sql<{ metres: number }[]>`
      select ST_Distance(a.geom, b.geom)::float8 as metres
      from places a, places b
      where a.slug = 'matara' and b.slug = 'galle'
    `;
    // Straight-line Matara -> Galle is roughly 38 km.
    expect(row?.metres).toBeGreaterThan(30_000);
    expect(row?.metres).toBeLessThan(50_000);
  });

  it('maintains updated_at through the trigger', async () => {
    const [before] = await handle.db.select().from(districts).where(eq(districts.id, 'matara'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handle.db
      .update(districts)
      .set({ sortOrder: before?.sortOrder ?? 1 })
      .where(eq(districts.id, 'matara'));
    const [after] = await handle.db.select().from(districts).where(eq(districts.id, 'matara'));
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0);
  });
});
