import { Inject, Injectable } from '@nestjs/common';
import type { CreateProviderLocationRequest, UpdateProviderLocationRequest } from '@vrp/contracts';
import {
  providerLocations,
  vehicles,
  type Database,
  type DatabaseExecutor,
  type ProviderLocation,
  type ProviderProfile,
} from '@vrp/database';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.types';
import { ReferenceService } from '../reference/reference.service';

export interface LocationWithCount {
  location: ProviderLocation;
  vehicleCount: number;
}

/**
 * Provider pickup / operating locations. District and gazetteer place are
 * required; the pin is optional (no paid map API). Locations are deactivated,
 * never deleted, so vehicles and later bookings keep their references.
 */
@Injectable()
export class ProviderLocationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reference: ReferenceService,
    private readonly audit: AuditService,
  ) {}

  async list(providerId: string): Promise<LocationWithCount[]> {
    const rows = await this.db
      .select()
      .from(providerLocations)
      .where(eq(providerLocations.providerId, providerId))
      .orderBy(
        desc(providerLocations.isActive),
        desc(providerLocations.isPrimary),
        asc(providerLocations.createdAt),
      );
    const counts = await this.vehicleCounts(providerId);
    return rows.map((location) => ({ location, vehicleCount: counts.get(location.id) ?? 0 }));
  }

  /** 404 for unknown ids and for other providers' locations alike. */
  async getOwned(
    providerId: string,
    id: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProviderLocation> {
    const [row] = await executor
      .select()
      .from(providerLocations)
      .where(and(eq(providerLocations.id, id), eq(providerLocations.providerId, providerId)))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Location not found', 404);
    return row;
  }

  async getOwnedWithCount(providerId: string, id: string): Promise<LocationWithCount> {
    const location = await this.getOwned(providerId, id);
    return { location, vehicleCount: await this.countVehiclesUsing(id) };
  }

  async create(
    provider: ProviderProfile,
    input: CreateProviderLocationRequest,
    meta: RequestMeta,
  ): Promise<LocationWithCount> {
    await this.assertReferences(input.districtId, input.placeId);

    const location = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(providerLocations)
        .where(
          and(eq(providerLocations.providerId, provider.id), eq(providerLocations.isActive, true)),
        );
      const makePrimary = input.isPrimary === true || (existing?.count ?? 0) === 0;
      if (makePrimary) await this.clearPrimary(tx, provider.id);

      const [row] = await tx
        .insert(providerLocations)
        .values({
          providerId: provider.id,
          name: input.name,
          districtId: input.districtId,
          placeId: input.placeId,
          addressText: input.addressText,
          geom: input.point ?? null,
          pickupInstructions: input.pickupInstructions ?? null,
          isPrimary: makePrimary,
        })
        .returning();
      if (!row) throw new Error('Failed to create location');

      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'provider_location.created',
          targetType: 'provider_location',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: {
            providerId: provider.id,
            districtId: row.districtId,
            placeId: row.placeId,
            isPrimary: row.isPrimary,
            hasPoint: row.geom !== null,
          },
        },
        tx,
      );
      return row;
    });
    return { location, vehicleCount: 0 };
  }

  async update(
    provider: ProviderProfile,
    id: string,
    patch: UpdateProviderLocationRequest,
    meta: RequestMeta,
  ): Promise<LocationWithCount> {
    const existing = await this.getOwned(provider.id, id);
    if (patch.isPrimary === false) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'isPrimary', issue: 'choose another location as primary instead' },
      ]);
    }
    if (patch.districtId !== undefined || patch.placeId !== undefined) {
      await this.assertReferences(
        patch.districtId ?? existing.districtId,
        patch.placeId ?? existing.placeId,
      );
    }
    const willBeActive = patch.isActive ?? existing.isActive;
    if (patch.isPrimary === true && !willBeActive) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'isPrimary', issue: 'an inactive location cannot be primary' },
      ]);
    }

    const updated = await this.db.transaction(async (tx) => {
      const deactivating = patch.isActive === false && existing.isActive;
      if (deactivating) {
        const inUse = await this.countVehiclesUsing(id, tx);
        if (inUse > 0) {
          throw new ApiException(
            'LOCATION_IN_USE',
            `This location is the pickup point of ${inUse} vehicle${inUse === 1 ? '' : 's'}; move them first`,
            409,
          );
        }
      }
      if (patch.isPrimary === true) await this.clearPrimary(tx, provider.id);

      const [row] = await tx
        .update(providerLocations)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.districtId !== undefined ? { districtId: patch.districtId } : {}),
          ...(patch.placeId !== undefined ? { placeId: patch.placeId } : {}),
          ...(patch.addressText !== undefined ? { addressText: patch.addressText } : {}),
          ...(patch.point !== undefined ? { geom: patch.point } : {}),
          ...(patch.pickupInstructions !== undefined
            ? { pickupInstructions: patch.pickupInstructions }
            : {}),
          ...(patch.isPrimary === true ? { isPrimary: true } : {}),
          ...(deactivating ? { isActive: false, isPrimary: false, deactivatedAt: new Date() } : {}),
          ...(patch.isActive === true && !existing.isActive
            ? { isActive: true, deactivatedAt: null }
            : {}),
        })
        .where(eq(providerLocations.id, id))
        .returning();
      if (!row) throw new ApiException('NOT_FOUND', 'Location not found', 404);

      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: deactivating ? 'provider_location.deactivated' : 'provider_location.updated',
          targetType: 'provider_location',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { providerId: provider.id, fields: Object.keys(patch) },
        },
        tx,
      );
      return row;
    });
    return { location: updated, vehicleCount: await this.countVehiclesUsing(id) };
  }

  /** Is this one of the provider's active locations? Used by the vehicle service. */
  async isUsable(
    providerId: string,
    locationId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ isActive: providerLocations.isActive })
      .from(providerLocations)
      .where(
        and(eq(providerLocations.id, locationId), eq(providerLocations.providerId, providerId)),
      )
      .limit(1);
    return row?.isActive === true;
  }

  // ------------------------------------------------------------- helpers

  private async assertReferences(districtId: string, placeId: string): Promise<void> {
    const issues = await this.reference.validateLocationReferences(districtId, placeId);
    if (issues.length > 0) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, issues);
    }
  }

  private async clearPrimary(executor: DatabaseExecutor, providerId: string): Promise<void> {
    await executor
      .update(providerLocations)
      .set({ isPrimary: false })
      .where(
        and(eq(providerLocations.providerId, providerId), eq(providerLocations.isPrimary, true)),
      );
  }

  /** Vehicles that still point at the location (anything but rejected/deleted). */
  async countVehiclesUsing(
    locationId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<number> {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.locationId, locationId),
          isNull(vehicles.deletedAt),
          ne(vehicles.status, 'rejected'),
        ),
      );
    return row?.count ?? 0;
  }

  private async vehicleCounts(providerId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ locationId: vehicles.locationId, count: sql<number>`count(*)::int` })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.providerId, providerId),
          isNull(vehicles.deletedAt),
          ne(vehicles.status, 'rejected'),
        ),
      )
      .groupBy(vehicles.locationId);
    return new Map(rows.filter((r) => r.locationId).map((r) => [r.locationId as string, r.count]));
  }
}
