/**
 * Local realistic demo (pre-staging visual review). Seeds fictional providers and
 * approved listings with licensed demo photography into a DEDICATED local database
 * (`vehicle_rental_demo` by default), never the dev, test or perf database, so the
 * browser E2E suite (which writes to the dev database) never mixes with the demo.
 *
 *   pnpm demo:seed            # create / top up the demo database (idempotent)
 *   pnpm demo:seed --reset    # delete the demo photo objects, drop and recreate the demo database
 *   pnpm demo:dev             # web + API against the demo database
 *   pnpm demo:worker          # worker against the demo database
 *
 * Safety: refuses NODE_ENV=production or any LAUNCH_MODE, a non-local database host
 * and non-local object storage. Every record is created in a state the application
 * itself produces (approved application → active profile → primary location →
 * approved listing with ≥ MIN_VEHICLE_PHOTOS photos), validated with the same
 * contracts the API uses. Photos go through the API's own pipeline
 * (`processVehiclePhoto`: sniffed, EXIF/GPS stripped, WebP variants) into the
 * private / public buckets with server-generated keys. No bookings, payments or
 * reviews are fabricated. Demo accounts get a random password that is never
 * printed (use "Forgot password" + Mailpit to look around as a provider).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CreateProviderLocationRequestSchema,
  CURRENT_PRIVACY_VERSION,
  CURRENT_PROVIDER_AGREEMENT_VERSION,
  CURRENT_TERMS_VERSION,
  MIN_VEHICLE_PHOTOS,
  PHOTO_VARIANTS,
  ProviderApplicationDraftSchema,
  ProviderApplicationRequiredSchema,
  VehicleFieldsSchema,
  vehicleSubmissionIssues,
  type PhotoVariant,
} from '@vrp/contracts';
import {
  auditEvents,
  createDatabase,
  loadRootEnv,
  places,
  providerApplications,
  providerLocations,
  providerProfiles,
  providerServiceAreas,
  providerVehicleCategories,
  runMigrations,
  runSeed,
  users,
  uuidv7,
  vehiclePhotos,
  vehicles,
  type Database,
} from '@vrp/database';
import argon2 from 'argon2';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { validateEnv, type Env } from '../../src/config/env.schema';
import { makeVehicleSlug } from '../../src/modules/catalogue/catalogue.helpers';
import { processVehiclePhoto } from '../../src/modules/storage/image-processor';
import { S3StorageProvider } from '../../src/modules/storage/s3-storage.provider';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_PROVIDERS,
  type DemoProvider,
  type DemoVehicle,
} from './demo-data';

const DEFAULT_DB = 'vehicle_rental_demo';
const PHOTO_DIR = path.join(__dirname, 'photos');
const VARIANT_NAMES = Object.keys(PHOTO_VARIANTS) as PhotoVariant[];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DEMO_AUDIT = { via: 'demo-seed' } as const;

interface Options {
  db: string;
  reset: boolean;
}

class DemoSeedRefused extends Error {}

function parseArgs(argv: string[]): Options {
  const options: Options = { db: process.env.DEMO_DATABASE_NAME ?? DEFAULT_DB, reset: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset') options.reset = true;
    else if (arg === '--db') options.db = String(argv[++i]);
    else throw new DemoSeedRefused(`Unknown argument ${arg} (use --reset, --db <name>_demo)`);
  }
  if (!/^[a-z_][a-z0-9_]*_demo$/.test(options.db)) {
    throw new DemoSeedRefused('--db must be a plain identifier ending in "_demo"');
  }
  return options;
}

/** Local development only: never production mode, a remote database or remote storage. */
function assertLocalOnly(): Env {
  if (process.env.NODE_ENV === 'production' || process.env.LAUNCH_MODE) {
    throw new DemoSeedRefused('demo:seed never runs with NODE_ENV=production or a LAUNCH_MODE');
  }
  // The API's own schema: same defaults (local MinIO) and the same validation.
  const env = validateEnv(process.env);
  if (!LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname)) {
    throw new DemoSeedRefused('demo:seed only runs against a database on localhost');
  }
  if (env.STORAGE_PROVIDER !== 's3') {
    throw new DemoSeedRefused('demo:seed needs the local MinIO storage (STORAGE_PROVIDER=s3)');
  }
  if (!LOCAL_HOSTS.has(new URL(env.STORAGE_ENDPOINT).hostname)) {
    throw new DemoSeedRefused('demo:seed only writes photos to object storage on localhost');
  }
  return env;
}

function databaseUrl(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

function storage(env: Env): S3StorageProvider {
  return new S3StorageProvider({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    accessKeyId: env.STORAGE_ACCESS_KEY,
    secretAccessKey: env.STORAGE_SECRET_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    buckets: { public: env.STORAGE_BUCKET_PUBLIC, private: env.STORAGE_BUCKET_PRIVATE },
    publicUrl: env.STORAGE_PUBLIC_URL,
    autoCreateBuckets: true,
  });
}

async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  const admin = createDatabase({ url: adminUrl, max: 1, applicationName: 'vrp-demo-seed' });
  try {
    const rows = await admin.db.execute<{ one: number }>(
      sql`select 1 as one from pg_database where datname = ${name}`,
    );
    return rows.length > 0;
  } finally {
    await admin.close();
  }
}

/** `--reset`: removes the demo photo objects first (they live in the shared MinIO buckets), then the database. */
async function resetDemo(env: Env, adminUrl: string, demoUrl: string, name: string): Promise<void> {
  if (!(await databaseExists(adminUrl, name))) return;
  const handle = createDatabase({ url: demoUrl, max: 1, applicationName: 'vrp-demo-seed' });
  try {
    const rows = await handle.db
      .select({ storageKey: vehiclePhotos.storageKey, publicPrefix: vehiclePhotos.publicPrefix })
      .from(vehiclePhotos);
    const store = storage(env);
    for (const row of rows) {
      await store.delete('private', [row.storageKey]);
      await store.delete(
        'public',
        VARIANT_NAMES.map((variant) => `${row.publicPrefix}/${variant}.webp`),
      );
    }
    console.warn(`reset: removed the objects of ${rows.length} demo photos`);
  } catch (error) {
    // A half-migrated demo database has no photo table yet; nothing to remove.
    console.warn(`reset: no demo photos removed (${(error as Error).message.slice(0, 80)})`);
  } finally {
    await handle.close();
  }
  const admin = createDatabase({ url: adminUrl, max: 1, applicationName: 'vrp-demo-seed' });
  try {
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    console.warn(`reset: dropped ${name}`);
  } finally {
    await admin.close();
  }
}

async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  if (await databaseExists(adminUrl, name)) return;
  const admin = createDatabase({ url: adminUrl, max: 1, applicationName: 'vrp-demo-seed' });
  try {
    await admin.db.execute(sql.raw(`create database "${name}"`));
    console.warn(`created ${name}`);
  } finally {
    await admin.close();
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function placeBySlug(db: Database, slug: string) {
  const [row] = await db
    .select({ id: places.id, slug: places.slug, districtId: places.districtId, geom: places.geom })
    .from(places)
    .where(eq(places.slug, slug))
    .limit(1);
  if (!row) throw new Error(`reference place "${slug}" is missing; the reference seed did not run`);
  return row;
}

function assertValid(label: string, issues: { field?: string; issue: string }[]): void {
  if (issues.length > 0) {
    throw new Error(
      `${label} would be refused by the API: ${issues.map((i) => `${i.field ?? '-'}: ${i.issue}`).join('; ')}`,
    );
  }
}

/** Provider: verified account → approved application → active profile → primary location. */
async function ensureProvider(
  db: Database,
  provider: DemoProvider,
  passwordHash: string,
): Promise<{ providerId: string; userId: string; locationId: string; placeSlug: string }> {
  const email = `${provider.key}@${DEMO_EMAIL_DOMAIN}`;
  const place = await placeBySlug(db, provider.placeSlug);
  const serviceAreas = await Promise.all(provider.serviceAreaSlugs.map((s) => placeBySlug(db, s)));

  const [existing] = await db
    .select({ userId: users.id, providerId: providerProfiles.id })
    .from(users)
    .innerJoin(providerProfiles, eq(providerProfiles.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    const [location] = await db
      .select({ id: providerLocations.id })
      .from(providerLocations)
      .where(
        and(
          eq(providerLocations.providerId, existing.providerId),
          eq(providerLocations.isPrimary, true),
        ),
      )
      .limit(1);
    if (!location) throw new Error(`demo provider ${provider.key} has no primary location`);
    return { ...existing, locationId: location.id, placeSlug: place.slug };
  }

  // The same validation the applicant form and the submit / approve steps apply.
  const draft = ProviderApplicationDraftSchema.parse({
    displayName: provider.displayName,
    providerType: provider.providerType,
    contactName: provider.contactName,
    phone: provider.phone,
    whatsapp: null,
    addressText: provider.addressText,
    districtId: place.districtId,
    primaryPlaceId: place.id,
    serviceAreaPlaceIds: serviceAreas.map((p) => p.id),
    description: provider.description,
    yearsOperating: provider.yearsOperating,
    vehicleCategoryIds: provider.vehicleCategoryIds,
    fleetSizeEstimate: provider.vehicles.length,
    offersDelivery: provider.vehicles.some((v) => v.fields.deliveryAvailable),
    offersAirportTransfer: false,
    websiteUrl: null,
  });
  ProviderApplicationRequiredSchema.parse(draft);
  const location = CreateProviderLocationRequestSchema.parse({
    name: `${provider.displayName} – ${provider.placeName}`,
    districtId: place.districtId,
    placeId: place.id,
    addressText: provider.addressText,
    // A fictional pin near the town centre; the public API only ever shows it rounded (~500 m).
    point: {
      lat: place.geom.lat + provider.pinOffset[0],
      lng: place.geom.lng + provider.pinOffset[1],
    },
    pickupInstructions: provider.pickupInstructions,
  });

  return db.transaction(async (tx) => {
    const now = new Date();
    const [user] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName: provider.contactName,
        emailVerifiedAt: now,
        roles: ['customer', 'provider'],
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        termsAcceptedAt: now,
      })
      .returning({ id: users.id });
    if (!user) throw new Error('user insert failed');
    const [application] = await tx
      .insert(providerApplications)
      .values({
        userId: user.id,
        status: 'approved',
        displayName: draft.displayName,
        providerType: draft.providerType,
        contactName: draft.contactName,
        phoneE164: draft.phone,
        whatsappE164: null,
        addressText: draft.addressText,
        districtId: draft.districtId,
        primaryPlaceId: draft.primaryPlaceId,
        serviceAreaPlaceIds: draft.serviceAreaPlaceIds,
        description: draft.description,
        yearsOperating: draft.yearsOperating,
        vehicleCategoryIds: draft.vehicleCategoryIds,
        fleetSizeEstimate: draft.fleetSizeEstimate,
        offersDelivery: draft.offersDelivery,
        offersAirportTransfer: false,
        agreementAcceptedAt: now,
        agreementVersion: CURRENT_PROVIDER_AGREEMENT_VERSION,
        submittedAt: now,
        approvedAt: now,
        reviewedAt: now,
        adminNotes: 'Fictional local demo provider (pnpm demo:seed).',
      })
      .returning({ id: providerApplications.id });
    if (!application) throw new Error('application insert failed');
    const [profile] = await tx
      .insert(providerProfiles)
      .values({
        userId: user.id,
        applicationId: application.id,
        slug: `${slugify(provider.displayName)}-demo`,
        displayName: provider.displayName,
        providerType: provider.providerType,
        contactName: provider.contactName,
        phoneE164: provider.phone,
        whatsappE164: null,
        description: provider.description,
        addressText: provider.addressText,
        districtId: place.districtId,
        primaryPlaceId: place.id,
        yearsOperating: provider.yearsOperating,
        fleetSizeEstimate: provider.vehicles.length,
        offersDelivery: draft.offersDelivery ?? false,
        offersAirportTransfer: false,
        status: 'active',
        approvedAt: now,
      })
      .returning({ id: providerProfiles.id });
    if (!profile) throw new Error('profile insert failed');
    const areaIds = serviceAreas.map((p) => p.id).filter((id) => id !== place.id);
    if (areaIds.length > 0) {
      await tx
        .insert(providerServiceAreas)
        .values(areaIds.map((placeId) => ({ providerId: profile.id, placeId })));
    }
    await tx
      .insert(providerVehicleCategories)
      .values(
        provider.vehicleCategoryIds.map((categoryId) => ({ providerId: profile.id, categoryId })),
      );
    const [loc] = await tx
      .insert(providerLocations)
      .values({
        providerId: profile.id,
        name: location.name,
        districtId: location.districtId,
        placeId: location.placeId,
        addressText: location.addressText,
        geom: location.point ?? null,
        pickupInstructions: location.pickupInstructions ?? null,
        isPrimary: true,
        isActive: true,
      })
      .returning({ id: providerLocations.id });
    if (!loc) throw new Error('location insert failed');
    await tx.insert(auditEvents).values([
      {
        actorUserId: user.id,
        actorType: 'provider',
        action: 'provider_application.submitted',
        targetType: 'provider_application',
        targetId: application.id,
        metadata: DEMO_AUDIT,
      },
      {
        actorUserId: null,
        actorType: 'system',
        action: 'provider_application.approved',
        targetType: 'provider_application',
        targetId: application.id,
        metadata: { ...DEMO_AUDIT, profileId: profile.id },
      },
    ]);
    console.warn(`provider: ${provider.displayName} (${provider.placeName})`);
    return { providerId: profile.id, userId: user.id, locationId: loc.id, placeSlug: place.slug };
  });
}

/** Listing: validated like a submission, photos through the upload pipeline, approved with a slug. */
async function ensureVehicle(
  db: Database,
  store: S3StorageProvider,
  owner: { providerId: string; userId: string; locationId: string; placeSlug: string },
  vehicle: DemoVehicle,
): Promise<'created' | 'exists'> {
  const fields = VehicleFieldsSchema.parse({ ...vehicle.fields, locationId: owner.locationId });
  const [existing] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.providerId, owner.providerId),
        eq(vehicles.registrationNumber, fields.registrationNumber),
        isNull(vehicles.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return 'exists';
  assertValid(fields.title, vehicleSubmissionIssues(fields, { photoCount: vehicle.photos.length }));
  if (vehicle.photos.length < MIN_VEHICLE_PHOTOS)
    throw new Error(`${fields.title}: too few photos`);

  const vehicleId = uuidv7();
  const photoRows: (typeof vehiclePhotos.$inferInsert)[] = [];
  for (const [index, file] of vehicle.photos.entries()) {
    const buffer = readFileSync(path.join(PHOTO_DIR, file));
    const processed = await processVehiclePhoto(buffer);
    const photoId = uuidv7();
    const prefix = `vehicles/${vehicleId}/${photoId}`;
    const storageKey = `${prefix}/original.${processed.format === 'jpeg' ? 'jpg' : processed.format}`;
    await store.put({
      bucket: 'private',
      key: storageKey,
      body: buffer,
      contentType: processed.mimeType,
    });
    for (const name of VARIANT_NAMES) {
      await store.put({
        bucket: 'public',
        key: `${prefix}/${name}.webp`,
        body: processed.variants[name],
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
    photoRows.push({
      id: photoId,
      vehicleId,
      storageKey,
      publicPrefix: prefix,
      mimeType: processed.mimeType,
      sizeBytes: buffer.length,
      width: processed.width,
      height: processed.height,
      sortOrder: index,
    });
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.insert(vehicles).values({
      id: vehicleId,
      providerId: owner.providerId,
      ...fields,
      status: 'approved',
      slug: makeVehicleSlug(fields, owner.placeSlug),
      internalName: fields.internalName ?? `demo:${vehicle.key}`,
      submittedAt: now,
      approvedAt: now,
      reviewedAt: now,
      adminNotes: 'Fictional local demo listing (pnpm demo:seed).',
    });
    await tx.insert(vehiclePhotos).values(photoRows);
    await tx.insert(auditEvents).values([
      {
        actorUserId: owner.userId,
        actorType: 'provider',
        action: 'vehicle.submitted',
        targetType: 'vehicle',
        targetId: vehicleId,
        metadata: DEMO_AUDIT,
      },
      {
        actorUserId: null,
        actorType: 'system',
        action: 'vehicle.approved',
        targetType: 'vehicle',
        targetId: vehicleId,
        metadata: DEMO_AUDIT,
      },
    ]);
  });
  console.warn(`  listing: ${fields.title} (${vehicle.photos.length} photos)`);
  return 'created';
}

async function main(): Promise<void> {
  loadRootEnv();
  const options = parseArgs(process.argv.slice(2));
  const env = assertLocalOnly();
  const base = env.DATABASE_URL;
  const adminUrl = databaseUrl(base, 'postgres');
  const demoUrl = databaseUrl(base, options.db);

  if (options.reset) await resetDemo(env, adminUrl, demoUrl, options.db);
  await ensureDatabase(adminUrl, options.db);
  await runMigrations(demoUrl, (m) => console.warn(m));

  const handle = createDatabase({ url: demoUrl, max: 2, applicationName: 'vrp-demo-seed' });
  try {
    const db = handle.db;
    const seeded = await runSeed(db);
    console.warn(`reference seed: ${JSON.stringify(seeded)}`);
    const active = await db.execute<{ id: string }>(
      sql`select id from vehicle_categories where is_active`,
    );
    const activeIds = new Set(active.map((r) => r.id));
    for (const provider of DEMO_PROVIDERS) {
      for (const id of [
        ...provider.vehicleCategoryIds,
        ...provider.vehicles.map((v) => v.fields.categoryId),
      ]) {
        if (!activeIds.has(id))
          throw new Error(`category "${id}" is not active; demo data must not use it`);
      }
    }

    const store = storage(env);
    await store.ensureBuckets();
    // Never printed and never reused: demo accounts are not meant for password login.
    const passwordHash = await argon2.hash(randomBytes(32).toString('base64url'), {
      type: argon2.argon2id,
    });

    let created = 0;
    let existing = 0;
    for (const provider of DEMO_PROVIDERS) {
      const owner = await ensureProvider(db, provider, passwordHash);
      for (const vehicle of provider.vehicles) {
        if ((await ensureVehicle(db, store, owner, vehicle)) === 'created') created += 1;
        else existing += 1;
      }
    }
    const [{ count } = { count: 0 }] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${vehicles} v
           join ${providerProfiles} p on p.id = v.provider_id
           join ${users} u on u.id = p.user_id
          where v.status = 'approved' and u.email like ${`%@${DEMO_EMAIL_DOMAIN}`}`,
    );
    const demoUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inArray(
          users.email,
          DEMO_PROVIDERS.map((p) => `${p.key}@${DEMO_EMAIL_DOMAIN}`),
        ),
      );
    console.warn(
      `done: ${DEMO_PROVIDERS.length} providers (${demoUsers.length} accounts), ${created} listings created, ${existing} already present, ${count} approved demo listings in ${options.db}`,
    );
    console.warn(
      'next: pnpm demo:dev (web + API) and pnpm demo:worker, then open http://localhost:3000',
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
