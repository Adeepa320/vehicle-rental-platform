import { Inject, Injectable } from '@nestjs/common';
import {
  PROTECTED_CATEGORY_REASON,
  PROTECTED_INACTIVE_CATEGORY_IDS,
  type AdminDistrict,
  type AdminPlace,
  type AdminPlaceListQuery,
  type AdminVehicleCategory,
  type CreatePlaceRequest,
  type UpdateDistrictRequest,
  type UpdatePlaceRequest,
  type UpdateVehicleCategoryRequest,
} from '@vrp/contracts';
import {
  districts,
  places,
  providerLocations,
  providerProfiles,
  vehicleCategories,
  vehicles,
  type Database,
  type District,
  type Place,
  type VehicleCategory,
} from '@vrp/database';
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { isUniqueViolation } from '../users/users.service';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Reference-data administration (Phase 9, super admin): districts and
 * categories keep their seeded identity and change operational flags and
 * display metadata; places can be created and edited. Nothing is hard
 * deleted — deactivation keeps every historical booking, location and
 * search log intact. Every change is audited with the before / after values.
 */
@Injectable()
export class AdminReferenceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminReferenceService.name);
  }

  // ------------------------------------------------------------ districts

  async listDistricts(): Promise<AdminDistrict[]> {
    const rows = await this.db
      .select({
        district: districts,
        // Correlated subqueries name the outer table explicitly: drizzle renders single-table
        // selects with unqualified columns, which would bind `id` to the subquery's alias.
        placeCount: sql<number>`(select count(*)::int from ${places} p where p.district_id = districts.id)`,
        providerCount: sql<number>`(select count(*)::int from ${providerProfiles} pp where pp.district_id = districts.id)`,
      })
      .from(districts)
      .orderBy(asc(districts.sortOrder), asc(districts.name));
    return rows.map((r) => this.toDistrict(r.district, r.placeCount, r.providerCount));
  }

  async updateDistrict(
    admin: AuthenticatedUser,
    id: string,
    input: UpdateDistrictRequest,
    meta: RequestMeta,
  ): Promise<AdminDistrict> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(districts).where(eq(districts.id, id)).for('update');
      if (!before) throw new ApiException('NOT_FOUND', 'District not found', 404);
      await tx.update(districts).set(input).where(eq(districts.id, id));
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'district.updated',
          targetType: 'district',
          targetId: null,
          ip: meta.ip ?? null,
          metadata: { districtId: id, before: this.pick(before, input), after: input },
        },
        tx,
      );
    });
    const row = (await this.listDistricts()).find((d) => d.id === id);
    if (!row) throw new ApiException('NOT_FOUND', 'District not found', 404);
    return row;
  }

  // --------------------------------------------------------------- places

  async listPlaces(query: AdminPlaceListQuery): Promise<AdminPlace[]> {
    const q = query.q ? `%${escapeLike(query.q)}%` : undefined;
    const rows = await this.db
      .select({
        place: places,
        locationCount: sql<number>`(select count(*)::int from ${providerLocations} l where l.place_id = places.id)`,
      })
      .from(places)
      .where(
        and(
          query.districtId ? eq(places.districtId, query.districtId) : undefined,
          q ? or(ilike(places.name, q), ilike(places.slug, q)) : undefined,
          query.includeInactive ? undefined : eq(places.isActive, true),
        ),
      )
      .orderBy(asc(places.districtId), asc(places.name));
    return rows.map((r) => this.toPlace(r.place, r.locationCount));
  }

  async createPlace(
    admin: AuthenticatedUser,
    input: CreatePlaceRequest,
    meta: RequestMeta,
  ): Promise<AdminPlace> {
    await this.assertPlaceReferences(input.districtId, input.parentId ?? null, null);
    const id = await this.db.transaction(async (tx) => {
      let row: Place | undefined;
      try {
        [row] = await tx
          .insert(places)
          .values({
            slug: input.slug,
            name: input.name,
            kind: input.kind,
            districtId: input.districtId,
            parentId: input.parentId ?? null,
            aliases: input.aliases ?? [],
            geom: { lat: input.centre.lat, lng: input.centre.lng },
            defaultRadiusKm: (input.defaultRadiusKm ?? 15).toFixed(1),
            isLaunchArea: input.isLaunchArea ?? false,
            searchRank: input.searchRank ?? 0,
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiException('CONFLICT', 'A place with this slug already exists', 409, [
            { field: 'slug', issue: 'already used' },
          ]);
        }
        throw error;
      }
      if (!row) throw new Error('Failed to create place');
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'place.created',
          targetType: 'place',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { slug: row.slug, districtId: row.districtId, kind: row.kind },
        },
        tx,
      );
      return row.id;
    });
    return this.getPlace(id);
  }

  async updatePlace(
    admin: AuthenticatedUser,
    id: string,
    input: UpdatePlaceRequest,
    meta: RequestMeta,
  ): Promise<AdminPlace> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(places).where(eq(places.id, id)).for('update');
      if (!before) throw new ApiException('NOT_FOUND', 'Place not found', 404);
      await this.assertPlaceReferences(
        input.districtId ?? before.districtId,
        input.parentId === undefined ? before.parentId : input.parentId,
        id,
      );
      const { centre, parentId, aliases, defaultRadiusKm, ...rest } = input;
      try {
        await tx
          .update(places)
          .set({
            ...rest,
            ...(centre ? { geom: { lat: centre.lat, lng: centre.lng } } : {}),
            ...(parentId !== undefined ? { parentId } : {}),
            ...(aliases !== undefined ? { aliases } : {}),
            ...(defaultRadiusKm !== undefined
              ? { defaultRadiusKm: defaultRadiusKm.toFixed(1) }
              : {}),
          })
          .where(eq(places.id, id));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiException('CONFLICT', 'A place with this slug already exists', 409, [
            { field: 'slug', issue: 'already used' },
          ]);
        }
        throw error;
      }
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'place.updated',
          targetType: 'place',
          targetId: id,
          ip: meta.ip ?? null,
          metadata: {
            before: this.pick(before, input),
            after: input,
          },
        },
        tx,
      );
    });
    return this.getPlace(id);
  }

  // ----------------------------------------------------------- categories

  async listCategories(): Promise<AdminVehicleCategory[]> {
    const rows = await this.db
      .select({
        category: vehicleCategories,
        vehicleCount: sql<number>`(select count(*)::int from ${vehicles} v where v.category_id = vehicle_categories.id and v.deleted_at is null)`,
      })
      .from(vehicleCategories)
      .orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.id));
    return rows.map((r) => this.toCategory(r.category, r.vehicleCount));
  }

  async updateCategory(
    admin: AuthenticatedUser,
    id: string,
    input: UpdateVehicleCategoryRequest,
    meta: RequestMeta,
  ): Promise<AdminVehicleCategory> {
    if (input.isActive === true && PROTECTED_INACTIVE_CATEGORY_IDS.includes(id)) {
      throw new ApiException('CONFLICT', PROTECTED_CATEGORY_REASON, 409, [
        { field: 'isActive', issue: 'category launch is pending a recorded product decision' },
      ]);
    }
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(vehicleCategories)
        .where(eq(vehicleCategories.id, id))
        .for('update');
      if (!before) throw new ApiException('NOT_FOUND', 'Category not found', 404);
      await tx.update(vehicleCategories).set(input).where(eq(vehicleCategories.id, id));
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'vehicle_category.updated',
          targetType: 'vehicle_category',
          targetId: null,
          ip: meta.ip ?? null,
          metadata: { categoryId: id, before: this.pick(before, input), after: input },
        },
        tx,
      );
    });
    const row = (await this.listCategories()).find((c) => c.id === id);
    if (!row) throw new ApiException('NOT_FOUND', 'Category not found', 404);
    return row;
  }

  // -------------------------------------------------------------- helpers

  private async getPlace(id: string): Promise<AdminPlace> {
    const [row] = await this.db
      .select({
        place: places,
        locationCount: sql<number>`(select count(*)::int from ${providerLocations} l where l.place_id = places.id)`,
      })
      .from(places)
      .where(eq(places.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Place not found', 404);
    return this.toPlace(row.place, row.locationCount);
  }

  private async assertPlaceReferences(
    districtId: string,
    parentId: string | null,
    selfId: string | null,
  ): Promise<void> {
    const [district] = await this.db
      .select({ id: districts.id })
      .from(districts)
      .where(eq(districts.id, districtId));
    if (!district) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'districtId', issue: 'unknown district' },
      ]);
    }
    if (parentId) {
      if (parentId === selfId) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          { field: 'parentId', issue: 'a place cannot be its own parent' },
        ]);
      }
      const [parent] = await this.db
        .select({ id: places.id, districtId: places.districtId })
        .from(places)
        .where(and(eq(places.id, parentId), isNull(places.parentId)));
      if (!parent || parent.districtId !== districtId) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          { field: 'parentId', issue: 'parent must be a top-level place in the same district' },
        ]);
      }
    }
  }

  private pick(
    row: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      const value = row[key === 'centre' ? 'geom' : key];
      out[key] = value instanceof Date ? value.toISOString() : (value ?? null);
    }
    return out;
  }

  private toDistrict(row: District, placeCount: number, providerCount: number): AdminDistrict {
    return {
      id: row.id,
      name: row.name,
      province: row.province,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      placeCount,
      providerCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toPlace(row: Place, locationCount: number): AdminPlace {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      districtId: row.districtId,
      parentId: row.parentId,
      aliases: row.aliases,
      centre: { lat: row.geom.lat, lng: row.geom.lng },
      defaultRadiusKm: Number(row.defaultRadiusKm),
      isLaunchArea: row.isLaunchArea,
      searchRank: row.searchRank,
      isActive: row.isActive,
      locationCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCategory(row: VehicleCategory, vehicleCount: number): AdminVehicleCategory {
    return {
      id: row.id,
      name: row.name,
      icon: row.icon,
      sortOrder: row.sortOrder,
      requiresLicenceClass: row.requiresLicenceClass,
      isActive: row.isActive,
      activationBlockedReason:
        !row.isActive && PROTECTED_INACTIVE_CATEGORY_IDS.includes(row.id)
          ? PROTECTED_CATEGORY_REASON
          : null,
      vehicleCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
