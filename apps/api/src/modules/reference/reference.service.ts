import { Inject, Injectable } from '@nestjs/common';
import type { ApiErrorDetail, District, PlaceSummary, VehicleCategory } from '@vrp/contracts';
import { districts, places, vehicleCategories, type Database } from '@vrp/database';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module';

export interface ApplicationReferences {
  districtId?: string | null;
  primaryPlaceId?: string | null;
  serviceAreaPlaceIds?: string[] | null;
  vehicleCategoryIds?: string[] | null;
}

/** Read access to the seeded reference data plus validation of ids supplied by clients. */
@Injectable()
export class ReferenceService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listDistricts(): Promise<District[]> {
    const rows = await this.db.select().from(districts).orderBy(asc(districts.sortOrder));
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      province: d.province,
      isActive: d.isActive,
    }));
  }

  async listPlaces(districtId?: string): Promise<PlaceSummary[]> {
    const rows = await this.db
      .select({
        id: places.id,
        slug: places.slug,
        name: places.name,
        kind: places.kind,
        districtId: places.districtId,
        parentId: places.parentId,
        isLaunchArea: places.isLaunchArea,
        searchRank: places.searchRank,
      })
      .from(places)
      .where(
        districtId
          ? and(eq(places.isActive, true), eq(places.districtId, districtId))
          : eq(places.isActive, true),
      )
      .orderBy(asc(places.districtId), asc(places.name));
    return rows.map(({ searchRank: _rank, ...rest }) => rest);
  }

  async listVehicleCategories(): Promise<VehicleCategory[]> {
    const rows = await this.db
      .select()
      .from(vehicleCategories)
      .where(eq(vehicleCategories.isActive, true))
      .orderBy(asc(vehicleCategories.sortOrder));
    return rows.map((c) => ({ id: c.id, name: c.name, icon: c.icon, sortOrder: c.sortOrder }));
  }

  /** District + place pair of a provider location: the place must be an active place in the district. */
  async validateLocationReferences(districtId: string, placeId: string): Promise<ApiErrorDetail[]> {
    const issues = await this.validateApplicationReferences({
      districtId,
      primaryPlaceId: placeId,
    });
    return issues.map((issue) =>
      issue.field === 'primaryPlaceId' ? { ...issue, field: 'placeId' } : issue,
    );
  }

  /** A single active vehicle category (vehicle listings). */
  async validateCategory(categoryId: string): Promise<ApiErrorDetail[]> {
    const issues = await this.validateApplicationReferences({ vehicleCategoryIds: [categoryId] });
    return issues.map((issue) => ({ ...issue, field: 'categoryId' }));
  }

  /**
   * Checks that every supplied reference id exists and is active, and that the
   * primary place lies in the chosen district. Returns field-level issues
   * (empty when valid). Missing values are not reported here: completeness is
   * a separate concern.
   */
  async validateApplicationReferences(refs: ApplicationReferences): Promise<ApiErrorDetail[]> {
    const issues: ApiErrorDetail[] = [];

    let district: { id: string; isActive: boolean } | undefined;
    if (refs.districtId) {
      [district] = await this.db
        .select({ id: districts.id, isActive: districts.isActive })
        .from(districts)
        .where(eq(districts.id, refs.districtId));
      if (!district) issues.push({ field: 'districtId', issue: 'unknown district' });
      else if (!district.isActive) {
        issues.push({
          field: 'districtId',
          issue: 'providers cannot operate from this district yet',
        });
      }
    }

    const placeIds = [
      ...(refs.primaryPlaceId ? [refs.primaryPlaceId] : []),
      ...(refs.serviceAreaPlaceIds ?? []),
    ];
    if (placeIds.length > 0) {
      const rows = await this.db
        .select({ id: places.id, districtId: places.districtId, isActive: places.isActive })
        .from(places)
        .where(inArray(places.id, [...new Set(placeIds)]));
      const byId = new Map(rows.map((r) => [r.id, r] as const));
      if (refs.primaryPlaceId) {
        const primary = byId.get(refs.primaryPlaceId);
        if (!primary || !primary.isActive) {
          issues.push({ field: 'primaryPlaceId', issue: 'unknown place' });
        } else if (refs.districtId && primary.districtId !== refs.districtId) {
          issues.push({ field: 'primaryPlaceId', issue: 'place is not in the selected district' });
        }
      }
      for (const [index, id] of (refs.serviceAreaPlaceIds ?? []).entries()) {
        const place = byId.get(id);
        if (!place || !place.isActive) {
          issues.push({ field: `serviceAreaPlaceIds.${index}`, issue: 'unknown place' });
        }
      }
    }

    const categoryIds = refs.vehicleCategoryIds ?? [];
    if (categoryIds.length > 0) {
      const rows = await this.db
        .select({ id: vehicleCategories.id, isActive: vehicleCategories.isActive })
        .from(vehicleCategories)
        .where(inArray(vehicleCategories.id, [...new Set(categoryIds)]));
      const active = new Set(rows.filter((r) => r.isActive).map((r) => r.id));
      for (const [index, id] of categoryIds.entries()) {
        if (!active.has(id)) {
          issues.push({
            field: `vehicleCategoryIds.${index}`,
            issue: 'unknown or inactive vehicle category',
          });
        }
      }
    }

    return issues;
  }
}
