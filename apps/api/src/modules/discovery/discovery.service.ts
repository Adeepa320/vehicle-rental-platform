import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_SEARCH_RADIUS_KM,
  rentalDays,
  type PlaceSuggestion,
  type PublicAvailability,
  type PublicPlace,
  type PublicVehicleDetail,
  type SearchSort,
  type VehicleSearchQuery,
  type VehicleSearchResponse,
  type PublicVehicleQuery,
  estimateRental,
} from '@vrp/contracts';
import {
  districts,
  places,
  providerLocations,
  providerProfiles,
  vehicleCategories,
  vehicleHolds,
  vehicles,
  type Database,
  type GeoPoint,
} from '@vrp/database';
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { VehiclePhotosService } from '../catalogue/vehicle-photos.service';
import {
  toCard,
  toDetail,
  toProviderSummary,
  toPublicPhoto,
  toPublicPricing,
  type SearchWindow,
} from './public.mappers';
import { searchableCondition } from './searchable';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sort value for vehicles without a pin when sorting by distance (after every real distance). */
const NO_DISTANCE = 1e12;

interface SortKey {
  expr: SQL;
  cast: 'float8' | 'numeric' | 'uuid';
}

interface Cursor {
  sort: SearchSort;
  values: (string | number)[];
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string | undefined, sort: SearchSort, size: number): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (parsed.sort !== sort || !Array.isArray(parsed.values) || parsed.values.length !== size) {
      throw new Error('mismatch');
    }
    return parsed;
  } catch {
    throw new ApiException('VALIDATION_ERROR', 'Invalid pagination cursor', 400, [
      { field: 'cursor', issue: 'malformed or from a different sort' },
    ]);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Public discovery over approved listings (TECH_DECISIONS D44). One query per
 * page for the vehicles plus one for their primary photos; availability is a
 * `NOT EXISTS` against `vehicle_holds`; distance and radius use PostGIS.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly photos: VehiclePhotosService,
  ) {}

  async search(query: VehicleSearchQuery): Promise<VehicleSearchResponse> {
    const place = query.placeId ? await this.loadPlace(query.placeId) : null;
    if (query.placeId && !place) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid query', 400, [
        { field: 'placeId', issue: 'unknown or inactive place' },
      ]);
    }
    const centre = place ? this.centreOf(place.geom) : null;
    const radiusM = Math.round(
      (query.radiusKm ?? place?.defaultRadiusKm ?? DEFAULT_SEARCH_RADIUS_KM) * 1000,
    );
    const window: SearchWindow | null =
      query.startsAt && query.endsAt
        ? {
            startsAt: new Date(query.startsAt).toISOString(),
            endsAt: new Date(query.endsAt).toISOString(),
            days: rentalDays(query.startsAt, query.endsAt),
          }
        : null;

    const conditions: (SQL | undefined)[] = [this.searchable()];
    if (place && centre) {
      conditions.push(
        or(
          eq(providerLocations.placeId, place.id),
          and(
            isNotNull(providerLocations.geom),
            sql`ST_DWithin(${providerLocations.geom}, ${centre}, ${radiusM})`,
          ),
        ),
      );
    }
    if (query.districtId) conditions.push(eq(providerLocations.districtId, query.districtId));
    if (query.categoryId) conditions.push(eq(vehicles.categoryId, query.categoryId));
    if (query.transmission) conditions.push(eq(vehicles.transmission, query.transmission));
    if (query.fuelType) conditions.push(eq(vehicles.fuelType, query.fuelType));
    if (query.minSeats !== undefined) conditions.push(gte(vehicles.seats, query.minSeats));
    if (query.hasAc) conditions.push(eq(vehicles.hasAc, true));
    if (query.deliveryAvailable) conditions.push(eq(vehicles.deliveryAvailable, true));
    if (query.minDailyRate) conditions.push(gte(vehicles.dailyRate, query.minDailyRate));
    if (query.maxDailyRate) conditions.push(lte(vehicles.dailyRate, query.maxDailyRate));
    if (window) {
      conditions.push(this.freeDuring(new Date(window.startsAt), new Date(window.endsAt)));
      conditions.push(
        sql`${window.days} between ${vehicles.minRentalDays} and coalesce(${vehicles.maxRentalDays}, 32767)`,
      );
    }

    // Sorting: every sort ends with the id so the order (and the cursor) is total.
    const distanceKey: SortKey = {
      expr: centre
        ? sql`coalesce(ST_Distance(${providerLocations.geom}, ${centre}), ${NO_DISTANCE})`
        : sql`${NO_DISTANCE}::float8`,
      cast: 'float8',
    };
    const priceKey: SortKey = { expr: sql`${vehicles.dailyRate}`, cast: 'numeric' };
    const idKey: SortKey = { expr: sql`${vehicles.id}`, cast: 'uuid' };
    const effectiveSort: SearchSort =
      query.sort === 'distance' && !centre ? 'relevance' : query.sort;
    const descending = effectiveSort === 'price_desc';
    const keys: SortKey[] =
      effectiveSort === 'price_asc' || effectiveSort === 'price_desc'
        ? [priceKey, idKey]
        : centre
          ? [distanceKey, priceKey, idKey]
          : [priceKey, idKey];

    const cursor = decodeCursor(query.cursor, effectiveSort, keys.length);
    if (cursor) {
      const left = sql.join(
        keys.map((k) => k.expr),
        sql`, `,
      );
      const right = sql.join(
        keys.map((k, i) => sql`${String(cursor.values[i])}::${sql.raw(k.cast)}`),
        sql`, `,
      );
      conditions.push(descending ? sql`(${left}) < (${right})` : sql`(${left}) > (${right})`);
    }

    const rows = await this.base(centre)
      .where(and(...conditions))
      .orderBy(...keys.map((k) => (descending ? desc(k.expr) : asc(k.expr))))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({
            sort: effectiveSort,
            values: keys.map((k) => {
              if (k === distanceKey) return last.distanceKey;
              if (k === priceKey) return last.vehicle.dailyRate ?? '0';
              return last.vehicle.id;
            }),
          })
        : null;

    const photosByVehicle = await this.photos.listActiveFor(page.map((r) => r.vehicle.id));
    const data = page.map((row) => {
      const primary = photosByVehicle.get(row.vehicle.id)?.[0];
      return toCard(
        row,
        primary ? toPublicPhoto(primary, this.photos.variantUrls(primary.publicPrefix)) : null,
        window,
      );
    });

    return {
      data,
      nextCursor,
      criteria: {
        place: place
          ? {
              id: place.id,
              slug: place.slug,
              name: place.name,
              districtId: place.districtId,
              districtName: place.districtName,
            }
          : null,
        districtId: query.districtId ?? null,
        radiusKm: place ? radiusM / 1000 : null,
        startsAt: window?.startsAt ?? null,
        endsAt: window?.endsAt ?? null,
        days: window?.days ?? null,
        sort: effectiveSort,
      },
    };
  }

  async getPublicVehicle(
    idOrSlug: string,
    query: PublicVehicleQuery,
  ): Promise<PublicVehicleDetail> {
    const [row] = await this.base(null)
      .where(
        and(
          this.searchable(),
          UUID.test(idOrSlug) ? eq(vehicles.id, idOrSlug) : eq(vehicles.slug, idOrSlug),
        ),
      )
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);

    const [photoRows, providerRow, vehicleCount] = await Promise.all([
      this.photos.listActive(row.vehicle.id),
      this.db
        .select({ profile: providerProfiles, place: { slug: places.slug, name: places.name } })
        .from(providerProfiles)
        .innerJoin(places, eq(places.id, providerProfiles.primaryPlaceId))
        .where(eq(providerProfiles.id, row.provider.id))
        .limit(1)
        .then((r) => r[0]),
      this.countSearchable(row.provider.id),
    ]);
    if (!providerRow) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);

    let availability: PublicAvailability | null = null;
    if (query.startsAt && query.endsAt) {
      const startsAt = new Date(query.startsAt);
      const endsAt = new Date(query.endsAt);
      const days = rentalDays(startsAt, endsAt);
      const [conflict] = await this.db
        .select({ id: vehicleHolds.id })
        .from(vehicleHolds)
        .where(
          and(
            eq(vehicleHolds.vehicleId, row.vehicle.id),
            sql`${vehicleHolds.startsAt} < ${endsAt.toISOString()}::timestamptz`,
            sql`${vehicleHolds.endsAt} > ${startsAt.toISOString()}::timestamptz`,
          ),
        )
        .limit(1);
      const pricing = toPublicPricing(row.vehicle);
      availability = {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        days,
        available: !conflict,
        meetsRentalLength:
          days >= row.vehicle.minRentalDays &&
          (row.vehicle.maxRentalDays === null || days <= row.vehicle.maxRentalDays),
        estimate: estimateRental(pricing, days),
      };
    }

    return toDetail(
      row,
      photoRows.map((p) => toPublicPhoto(p, this.photos.variantUrls(p.publicPrefix))),
      toProviderSummary(providerRow.profile, providerRow.place, vehicleCount),
      availability,
    );
  }

  async suggestPlaces(q: string, limit: number): Promise<PlaceSuggestion[]> {
    const prefix = `${escapeLike(q)}%`;
    const contains = `%${escapeLike(q)}%`;
    const rows = await this.db
      .select({
        id: places.id,
        slug: places.slug,
        name: places.name,
        kind: places.kind,
        districtId: places.districtId,
        districtName: districts.name,
        isLaunchArea: places.isLaunchArea,
      })
      .from(places)
      .innerJoin(districts, eq(districts.id, places.districtId))
      .where(
        and(
          eq(places.isActive, true),
          eq(districts.isActive, true),
          or(
            ilike(places.name, prefix),
            ilike(places.name, contains),
            sql`exists (select 1 from unnest(${places.aliases}) alias where alias ilike ${prefix})`,
          ),
        ),
      )
      .orderBy(desc(places.isLaunchArea), desc(places.searchRank), asc(places.name))
      .limit(limit);
    return rows;
  }

  // ------------------------------------------------------------- helpers

  /** Everything a listing must satisfy to be visible to customers (shared with quotes and bookings). */
  private searchable(): SQL {
    return searchableCondition();
  }

  /** No hold intersects the half-open window `[start, end)`. */
  private freeDuring(start: Date, end: Date): SQL {
    // Raw fragments need typed parameters: pass ISO strings and cast (Dates are not serialisable here).
    return sql`not exists (select 1 from ${vehicleHolds} h where h.vehicle_id = ${vehicles.id} and h.starts_at < ${end.toISOString()}::timestamptz and h.ends_at > ${start.toISOString()}::timestamptz)`;
  }

  private centreOf(point: GeoPoint): SQL {
    return sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
  }

  private base(centre: SQL | null) {
    return this.db
      .select({
        vehicle: vehicles,
        provider: {
          id: providerProfiles.id,
          slug: providerProfiles.slug,
          displayName: providerProfiles.displayName,
        },
        location: { geom: providerLocations.geom, placeId: providerLocations.placeId },
        place: {
          id: places.id,
          slug: places.slug,
          name: places.name,
          districtId: places.districtId,
          geom: places.geom,
        },
        districtName: districts.name,
        distanceM: centre
          ? sql<number | null>`ST_Distance(${providerLocations.geom}, ${centre})`
          : sql<number | null>`null::float8`,
        distanceKey: centre
          ? sql<number>`coalesce(ST_Distance(${providerLocations.geom}, ${centre}), ${NO_DISTANCE})`
          : sql<number>`${NO_DISTANCE}::float8`,
      })
      .from(vehicles)
      .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
      .innerJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
      .innerJoin(places, eq(places.id, providerLocations.placeId))
      .innerJoin(districts, eq(districts.id, places.districtId))
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .$dynamic();
  }

  private async loadPlace(
    id: string,
  ): Promise<(PublicPlace & { geom: GeoPoint; defaultRadiusKm: number }) | null> {
    const [row] = await this.db
      .select({
        id: places.id,
        slug: places.slug,
        name: places.name,
        districtId: places.districtId,
        districtName: districts.name,
        geom: places.geom,
        defaultRadiusKm: places.defaultRadiusKm,
        isActive: places.isActive,
      })
      .from(places)
      .innerJoin(districts, eq(districts.id, places.districtId))
      .where(eq(places.id, id))
      .limit(1);
    if (!row || !row.isActive) return null;
    return { ...row, defaultRadiusKm: Number(row.defaultRadiusKm) };
  }

  /** Discoverable listings of a provider (same predicate as search). */
  private async countSearchable(providerId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(vehicles)
      .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
      .innerJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(and(this.searchable(), eq(vehicles.providerId, providerId)));
    return row?.count ?? 0;
  }
}
