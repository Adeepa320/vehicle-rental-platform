/**
 * Supply readiness report (Phase 10, docs/runbooks/GO_LIVE_CHECKLIST.md §H).
 * Counts the real inventory the marketplace can show customers today and
 * compares it with the launch target from docs/ROADMAP.md (20–40 vehicles in
 * the five South Coast launch towns). Read-only; prints no personal data.
 *
 *   pnpm supply:report [--json] [--strict]
 *
 * "Searchable" is the public predicate (`searchableCondition`): approved listing
 * with a slug, active provider, active pickup location, active category and at
 * least MIN_VEHICLE_PHOTOS photos. "Documents verified" uses the same derived
 * rules as the badges (`vehicleVerification` / `providerVerification`). With
 * `--strict` the exit code is 1 while the gate is not met.
 */
import {
  createDatabase,
  loadRootEnv,
  places,
  providerLocations,
  providerProfiles,
  requireEnv,
  vehicleCategories,
  vehicles,
  verificationDocuments,
  type Database,
} from '@vrp/database';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { searchableCondition } from '../modules/discovery/searchable';
import {
  providerVerification,
  vehicleVerification,
} from '../modules/documents/document.verification';

/** docs/ROADMAP.md cross-phase supply track: 20–40 vehicles before Phase 10 ends. */
export const SUPPLY_TARGET_MIN = 20;
export const SUPPLY_TARGET_MAX = 40;
export const GATE_MET = 'BUSINESS GO-LIVE GATE — MET';
export const GATE_NOT_MET = 'BUSINESS GO-LIVE GATE — NOT MET';

export interface SupplyReport {
  generatedAt: string;
  target: { min: number; max: number };
  providers: { active: number; withSearchableVehicles: number; documentsVerified: number };
  vehicles: { approved: number; searchable: number; documentsVerified: number };
  launchTowns: { name: string; searchableVehicles: number }[];
  launchTownsCovered: number;
  launchTownsTotal: number;
  gate: typeof GATE_MET | typeof GATE_NOT_MET;
  reasons: string[];
  /** The report cannot tell fixtures from real inventory; only a production run is evidence. */
  note: string;
}

export const SUPPLY_REPORT_NOTE =
  'Counts reflect the connected database. Development and test databases hold fixtures, so only a run against the production database is evidence for the go-live gate.';

function colomboToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now);
}

export async function buildSupplyReport(db: Database, now = new Date()): Promise<SupplyReport> {
  const today = colomboToday(now);

  const [activeProviders] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerProfiles)
    .where(and(eq(providerProfiles.status, 'active'), isNull(providerProfiles.deletedAt)));

  const [approvedVehicles] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vehicles)
    .where(and(eq(vehicles.status, 'approved'), isNull(vehicles.deletedAt)));

  const searchable = await db
    .select({
      vehicleId: vehicles.id,
      providerId: vehicles.providerId,
      providerType: providerProfiles.providerType,
      placeName: places.name,
      placeIsLaunchArea: places.isLaunchArea,
    })
    .from(vehicles)
    .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
    .innerJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .leftJoin(places, eq(places.id, providerLocations.placeId))
    .where(searchableCondition());

  const launchPlaces = await db
    .select({ name: places.name })
    .from(places)
    .where(and(eq(places.isLaunchArea, true), eq(places.isActive, true)))
    .orderBy(places.name);

  const vehicleIds = searchable.map((row) => row.vehicleId);
  const providerIds = [...new Set(searchable.map((row) => row.providerId))];

  const docs =
    vehicleIds.length === 0 && providerIds.length === 0
      ? []
      : await db
          .select({
            providerId: verificationDocuments.providerId,
            vehicleId: verificationDocuments.vehicleId,
            scope: verificationDocuments.scope,
            type: verificationDocuments.type,
            status: verificationDocuments.status,
            expiresOn: verificationDocuments.expiresOn,
            supersededAt: verificationDocuments.supersededAt,
          })
          .from(verificationDocuments)
          .where(
            and(
              isNull(verificationDocuments.supersededAt),
              providerIds.length > 0
                ? inArray(verificationDocuments.providerId, providerIds)
                : sql`false`,
            ),
          );

  let vehiclesVerified = 0;
  for (const id of vehicleIds) {
    const current = docs.filter((d) => d.scope === 'vehicle' && d.vehicleId === id);
    if (vehicleVerification(current, today).verified) vehiclesVerified += 1;
  }
  let providersVerified = 0;
  for (const providerId of providerIds) {
    const row = searchable.find((r) => r.providerId === providerId);
    if (!row) continue;
    const current = docs.filter((d) => d.scope === 'provider' && d.providerId === providerId);
    if (providerVerification(row.providerType, current, today).verified) providersVerified += 1;
  }

  const perTown = new Map<string, number>(launchPlaces.map((p) => [p.name, 0]));
  for (const row of searchable) {
    if (row.placeIsLaunchArea && row.placeName) {
      perTown.set(row.placeName, (perTown.get(row.placeName) ?? 0) + 1);
    }
  }
  const launchTowns = [...perTown.entries()].map(([name, searchableVehicles]) => ({
    name,
    searchableVehicles,
  }));
  const launchTownsCovered = launchTowns.filter((t) => t.searchableVehicles > 0).length;

  const reasons: string[] = [];
  if (searchable.length < SUPPLY_TARGET_MIN) {
    reasons.push(
      `${searchable.length} searchable vehicle(s); the launch target is ${SUPPLY_TARGET_MIN}–${SUPPLY_TARGET_MAX}`,
    );
  }
  if (launchTowns.length > 0 && launchTownsCovered < launchTowns.length) {
    reasons.push(
      `only ${launchTownsCovered} of ${launchTowns.length} launch towns have a searchable vehicle`,
    );
  }
  if (providerIds.length === 0) reasons.push('no provider has a searchable vehicle');

  return {
    generatedAt: now.toISOString(),
    target: { min: SUPPLY_TARGET_MIN, max: SUPPLY_TARGET_MAX },
    providers: {
      active: activeProviders?.count ?? 0,
      withSearchableVehicles: providerIds.length,
      documentsVerified: providersVerified,
    },
    vehicles: {
      approved: approvedVehicles?.count ?? 0,
      searchable: searchable.length,
      documentsVerified: vehiclesVerified,
    },
    launchTowns,
    launchTownsCovered,
    launchTownsTotal: launchTowns.length,
    gate: searchable.length >= SUPPLY_TARGET_MIN ? GATE_MET : GATE_NOT_MET,
    reasons,
    note: SUPPLY_REPORT_NOTE,
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = new Set(process.argv.slice(2));
  const handle = createDatabase({
    url: requireEnv('DATABASE_URL'),
    max: 1,
    applicationName: 'vrp-supply-report',
  });
  try {
    const report = await buildSupplyReport(handle.db);
    if (args.has('--json')) {
      console.warn(JSON.stringify(report, null, 2));
    } else {
      console.warn(`Supply readiness report — ${report.generatedAt}`);
      console.warn(
        `Providers: ${report.providers.active} active, ${report.providers.withSearchableVehicles} with a searchable vehicle, ${report.providers.documentsVerified} with verified documents`,
      );
      console.warn(
        `Vehicles: ${report.vehicles.approved} approved, ${report.vehicles.searchable} searchable, ${report.vehicles.documentsVerified} with verified documents (target ${report.target.min}–${report.target.max} searchable)`,
      );
      for (const town of report.launchTowns) {
        console.warn(`  ${town.name.padEnd(14)} ${town.searchableVehicles} searchable`);
      }
      console.warn(
        `Launch towns covered: ${report.launchTownsCovered} of ${report.launchTownsTotal}`,
      );
      console.warn(report.gate);
      for (const reason of report.reasons) console.warn(`  - ${reason}`);
      console.warn(report.note);
    }
    if (args.has('--strict') && report.gate === GATE_NOT_MET) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
