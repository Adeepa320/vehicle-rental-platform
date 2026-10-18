/**
 * Synthetic performance dataset (Phase 10, PRD §4 "search p95 < 500 ms at 10k listings").
 * Creates an ISOLATED database (never the dev or test one), applies the migrations and
 * the reference seed, then generates deterministic providers, pickup locations, approved
 * listings with photo metadata, availability blocks and customer accounts.
 *
 *   pnpm perf:seed                       # 400 providers × 25 vehicles = 10,000 listings into vehicle_rental_perf
 *   pnpm perf:seed --vehicles 2000       # smaller
 *   pnpm perf:seed --drop                # recreate the database first
 *   pnpm perf:seed --accounts-out <file> # write the login details the load generator uses
 *
 * Point the API at it with DATABASE_URL=<same server>/vehicle_rental_perf. Nothing here is
 * ever meant for production: names, e-mails (@perf.invalid) and plates are obviously fake,
 * photo rows point at keys that do not exist in storage, and the password is printed.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import argon2 from 'argon2';
import {
  blockReason,
  createDatabase,
  fuelType,
  loadRootEnv,
  places,
  providerApplications,
  providerLocations,
  providerProfiles,
  providerType,
  requireEnv,
  runMigrations,
  runSeed,
  transmission,
  users,
  vehicleCategories,
  vehicleHolds,
  vehiclePhotos,
  vehicles,
  type Database,
} from '@vrp/database';
import { eq, sql } from 'drizzle-orm';

const PERF_PASSWORD = 'perf-customer-password-123';
const DAY = 86_400_000;

interface Options {
  vehicles: number;
  providers: number;
  customers: number;
  db: string;
  drop: boolean;
  accountsOut?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    vehicles: 10_000,
    providers: 400,
    customers: 50,
    db: 'vehicle_rental_perf',
    drop: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--vehicles') options.vehicles = Number(argv[++i]);
    else if (arg === '--providers') options.providers = Number(argv[++i]);
    else if (arg === '--customers') options.customers = Number(argv[++i]);
    else if (arg === '--db') options.db = String(argv[++i]);
    else if (arg === '--drop') options.drop = true;
    else if (arg === '--accounts-out') options.accountsOut = String(argv[++i]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (
    !/^[a-z_][a-z0-9_]*$/.test(options.db) ||
    /^(vehicle_rental|vehicle_rental_test)$/.test(options.db)
  ) {
    throw new Error('--db must be a plain identifier and must not be the dev or test database');
  }
  return options;
}

/** Deterministic PRNG (mulberry32) so two runs produce the same dataset. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAKES: Array<[string, string[]]> = [
  ['Toyota', ['Aqua', 'Prius', 'Vitz', 'Axio', 'Hiace', 'Land Cruiser']],
  ['Suzuki', ['Alto', 'Wagon R', 'Swift', 'Every']],
  ['Honda', ['Fit', 'Vezel', 'Civic', 'Grace']],
  ['Nissan', ['Leaf', 'March', 'X-Trail', 'Caravan']],
  ['Mitsubishi', ['Montero', 'Outlander', 'L200']],
  ['Bajaj', ['Pulsar', 'CT100', 'Platina']],
  ['Honda Bikes', ['CB Hornet', 'Dio', 'Navi']],
];

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

function money(random: () => number, min: number, max: number, step = 100): string {
  const value = min + Math.floor((random() * (max - min)) / step) * step;
  return `${value}.00`;
}

async function ensureDatabase(baseUrl: string, name: string, drop: boolean): Promise<string> {
  const url = new URL(baseUrl);
  const perfUrl = new URL(baseUrl);
  perfUrl.pathname = `/${name}`;
  url.pathname = '/postgres';
  const admin = createDatabase({ url: url.toString(), max: 1, applicationName: 'vrp-perf-seed' });
  try {
    if (drop) {
      await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
      console.warn(`dropped ${name}`);
    }
    const [exists] = await admin.db.execute<{ one: number }>(
      sql`select 1 as one from pg_database where datname = ${name}`,
    );
    if (!exists) {
      await admin.db.execute(sql.raw(`create database "${name}"`));
      console.warn(`created ${name}`);
    }
  } finally {
    await admin.close();
  }
  return perfUrl.toString();
}

async function chunkedInsert<T extends { id: string }>(
  rows: unknown[],
  size: number,
  insert: (chunk: unknown[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(...(await insert(rows.slice(i, i + size))));
  }
  return out;
}

async function main(): Promise<void> {
  loadRootEnv();
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const perfUrl = await ensureDatabase(requireEnv('DATABASE_URL'), options.db, options.drop);
  await runMigrations(perfUrl, (m) => console.warn(m));
  const handle = createDatabase({ url: perfUrl, max: 4, applicationName: 'vrp-perf-seed' });
  const db: Database = handle.db;
  try {
    const seeded = await runSeed(db);
    console.warn(`reference seed: ${JSON.stringify(seeded)}`);
    const random = rng(42);
    const passwordHash = await argon2.hash(PERF_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 16384,
      timeCost: 2,
      parallelism: 1,
    });
    const now = new Date();
    const launchPlaces = await db
      .select({
        id: places.id,
        districtId: places.districtId,
        geom: places.geom,
        name: places.name,
      })
      .from(places)
      .where(eq(places.isLaunchArea, true));
    if (launchPlaces.length === 0) throw new Error('no launch-area places in the reference seed');
    const categories = (
      await db
        .select({ id: vehicleCategories.id })
        .from(vehicleCategories)
        .where(eq(vehicleCategories.isActive, true))
    ).map((c) => c.id);
    const weightedCategories = categories.flatMap((id) =>
      id === 'car' ? Array<string>(5).fill(id) : id === 'bike' ? [id, id] : [id],
    );
    const [existing] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${vehicles}`,
    );
    if ((existing?.count ?? 0) > 0) {
      throw new Error(
        `${options.db} already holds ${existing?.count} vehicles; run with --drop to regenerate`,
      );
    }

    // ---- providers (user + approved application + active profile + primary location)
    const providerUsers = await chunkedInsert(
      Array.from({ length: options.providers }, (_, i) => ({
        email: `perf-provider-${i}@perf.invalid`,
        passwordHash,
        fullName: `Provider ${i}`,
        emailVerifiedAt: now,
        roles: ['customer', 'provider'],
        termsVersion: '2026-10',
        termsAcceptedAt: now,
      })),
      200,
      async (chunk) =>
        db
          .insert(users)
          .values(chunk as (typeof users.$inferInsert)[])
          .returning({ id: users.id, email: users.email }),
    );
    const applications = await chunkedInsert(
      providerUsers.map((u, i) => ({
        userId: u.id,
        status: 'approved',
        displayName: `Perf Rentals ${i}`,
        providerType: pick(random, providerType.enumValues),
        contactName: `Provider ${i}`,
        phoneE164: `+9477${String(1000000 + i).slice(-7)}`,
        districtId: launchPlaces[i % launchPlaces.length]?.districtId,
        primaryPlaceId: launchPlaces[i % launchPlaces.length]?.id,
        submittedAt: now,
        approvedAt: now,
      })),
      200,
      async (chunk) =>
        db
          .insert(providerApplications)
          .values(chunk as (typeof providerApplications.$inferInsert)[])
          .returning({ id: providerApplications.id, userId: providerApplications.userId }),
    );
    const profiles = await chunkedInsert(
      applications.map((a, i) => {
        const place = launchPlaces[i % launchPlaces.length] as (typeof launchPlaces)[number];
        return {
          userId: a.userId,
          applicationId: a.id,
          slug: `perf-rentals-${i}`,
          displayName: `Perf Rentals ${i}`,
          providerType: pick(random, providerType.enumValues),
          contactName: `Provider ${i}`,
          phoneE164: `+9477${String(1000000 + i).slice(-7)}`,
          addressText: `${i} Beach Road, ${place.name}`,
          districtId: place.districtId,
          primaryPlaceId: place.id,
          status: 'active',
          approvedAt: now,
        };
      }),
      200,
      async (chunk) =>
        db
          .insert(providerProfiles)
          .values(chunk as (typeof providerProfiles.$inferInsert)[])
          .returning({ id: providerProfiles.id, userId: providerProfiles.userId }),
    );
    const locations = await chunkedInsert(
      profiles.map((p, i) => {
        const place = launchPlaces[i % launchPlaces.length] as (typeof launchPlaces)[number];
        const centre = place.geom;
        return {
          providerId: p.id,
          name: `Pickup ${i}`,
          districtId: place.districtId,
          placeId: place.id,
          addressText: `${i} Beach Road, ${place.name}`,
          geom: {
            lat: centre.lat + (random() - 0.5) * 0.12,
            lng: centre.lng + (random() - 0.5) * 0.12,
          },
          isPrimary: true,
          isActive: true,
        };
      }),
      200,
      async (chunk) =>
        db
          .insert(providerLocations)
          .values(chunk as (typeof providerLocations.$inferInsert)[])
          .returning({ id: providerLocations.id, providerId: providerLocations.providerId }),
    );
    console.warn(`providers: ${profiles.length}, locations: ${locations.length}`);

    // ---- vehicles (approved, with slugs; 3 photo rows each) and availability blocks
    const perProvider = Math.ceil(options.vehicles / options.providers);
    const vehicleRows: (typeof vehicles.$inferInsert)[] = [];
    for (let i = 0; i < options.vehicles; i += 1) {
      const providerIndex = Math.floor(i / perProvider);
      const profile = profiles[providerIndex] as (typeof profiles)[number];
      const location = locations[providerIndex] as (typeof locations)[number];
      const categoryId = pick(random, weightedCategories);
      const [make, models] = pick(random, MAKES);
      const model = pick(random, models);
      const year = 2012 + Math.floor(random() * 13);
      const isBike = categoryId === 'bike';
      vehicleRows.push({
        providerId: profile.id,
        locationId: location.id,
        categoryId,
        status: 'approved',
        slug: `perf-${make.toLowerCase().replace(/\s+/g, '-')}-${model.toLowerCase().replace(/\s+/g, '-')}-${year}-${i}`,
        title: `${make} ${model} ${year}`,
        make,
        model,
        modelYear: year,
        transmission: pick(random, transmission.enumValues),
        fuelType: pick(random, fuelType.enumValues),
        seats: isBike ? 2 : 4 + Math.floor(random() * 4),
        hasAc: !isBike && random() > 0.2,
        registrationNumber: `PF-${String(i).padStart(5, '0')}`,
        dailyRate: isBike ? money(random, 1500, 4000) : money(random, 5000, 25000, 500),
        weeklyRate: isBike ? money(random, 8000, 20000) : money(random, 30000, 140000, 1000),
        securityDeposit: isBike ? '5000.00' : money(random, 10000, 50000, 5000),
        includedKmPerDay: 100,
        extraKmRate: '40.00',
        minRentalDays: 1,
        maxRentalDays: 30,
        submittedAt: now,
        approvedAt: now,
      });
    }
    const vehicleIds = await chunkedInsert(vehicleRows, 500, async (chunk) =>
      db
        .insert(vehicles)
        .values(chunk as (typeof vehicles.$inferInsert)[])
        .returning({ id: vehicles.id, providerId: vehicles.providerId }),
    );
    const photoRows = vehicleIds.flatMap((v) =>
      [0, 1, 2].map((order) => {
        const photoId = randomUUID();
        return {
          vehicleId: v.id,
          storageKey: `vehicles/${v.id}/${photoId}/original.jpg`,
          publicPrefix: `vehicles/${v.id}/${photoId}`,
          mimeType: 'image/jpeg',
          sizeBytes: 150_000,
          width: 1600,
          height: 1200,
          sortOrder: order,
        };
      }),
    );
    await chunkedInsert(photoRows, 1500, async (chunk) =>
      db
        .insert(vehiclePhotos)
        .values(chunk as (typeof vehiclePhotos.$inferInsert)[])
        .returning({ id: vehiclePhotos.id }),
    );
    const ownerByProvider = new Map(profiles.map((p) => [p.id, p.userId]));
    const holdRows: (typeof vehicleHolds.$inferInsert)[] = [];
    for (const v of vehicleIds) {
      if (random() > 0.2) continue;
      let day = 1 + Math.floor(random() * 10);
      const blocks = 1 + Math.floor(random() * 3);
      for (let b = 0; b < blocks && day < 60; b += 1) {
        const length = 1 + Math.floor(random() * 4);
        holdRows.push({
          vehicleId: v.id,
          startsAt: new Date(now.getTime() + day * DAY),
          endsAt: new Date(now.getTime() + (day + length) * DAY),
          kind: 'block',
          blockReason: pick(random, blockReason.enumValues),
          note: 'perf block',
          createdBy: ownerByProvider.get(v.providerId) ?? null,
        });
        day += length + 1 + Math.floor(random() * 10);
      }
    }
    await chunkedInsert(holdRows, 1000, async (chunk) =>
      db
        .insert(vehicleHolds)
        .values(chunk as (typeof vehicleHolds.$inferInsert)[])
        .returning({ id: vehicleHolds.id }),
    );
    console.warn(
      `vehicles: ${vehicleIds.length}, photos: ${photoRows.length}, blocks: ${holdRows.length}`,
    );

    // ---- customers for the booking load
    const customers = await chunkedInsert(
      Array.from({ length: options.customers }, (_, i) => ({
        email: `perf-customer-${i}@perf.invalid`,
        passwordHash,
        fullName: `Customer ${i}`,
        emailVerifiedAt: now,
        termsVersion: '2026-10',
        termsAcceptedAt: now,
      })),
      200,
      async (chunk) =>
        db
          .insert(users)
          .values(chunk as (typeof users.$inferInsert)[])
          .returning({ id: users.id, email: users.email }),
    );
    await db.execute(sql`analyze`);

    if (options.accountsOut) {
      const slugsByProvider = new Map<string, string[]>();
      vehicleRows.forEach((row, i) => {
        const id = vehicleIds[i]?.providerId as string;
        const list = slugsByProvider.get(id) ?? [];
        if (list.length < 25) list.push(row.slug as string);
        slugsByProvider.set(id, list);
      });
      writeFileSync(
        options.accountsOut,
        JSON.stringify(
          {
            password: PERF_PASSWORD,
            customers: customers.map((c) => ({ email: c.email })),
            providers: profiles.slice(0, 50).map((p, i) => ({
              email: providerUsers[i]?.email,
              providerId: p.id,
              vehicleSlugs: slugsByProvider.get(p.id) ?? [],
            })),
          },
          null,
          2,
        ),
      );
      console.warn(`accounts written to ${options.accountsOut}`);
    }
    console.warn(
      `done in ${Math.round((Date.now() - started) / 1000)} s — DATABASE_URL for the API: ${perfUrl.replace(/\/\/[^@]*@/, '//***@')}`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
