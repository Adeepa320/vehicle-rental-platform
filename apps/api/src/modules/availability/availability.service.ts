import { Inject, Injectable } from '@nestjs/common';
import type {
  AvailabilityRangeQuery,
  CreateAvailabilityBlockRequest,
  HoldListQuery,
  VehicleAvailability,
} from '@vrp/contracts';
import {
  vehicleHolds,
  vehicles,
  type Database,
  type DatabaseExecutor,
  type ProviderProfile,
  type VehicleHold,
} from '@vrp/database';
import { and, asc, eq, gt, lt } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.types';
import { isDeadlock, isExclusionViolation } from '../catalogue/catalogue.helpers';
import { toHold } from '../catalogue/vehicle.mappers';
import { BLOCKABLE_STATUSES, isBookable } from '../catalogue/vehicle.state';
import { VehiclesService } from '../catalogue/vehicles.service';

const DAY_MS = 86_400_000;

/**
 * Availability = "approved unless held" (TECH_DECISIONS D40). Phase 4 manages
 * provider manual blocks only; booking holds join the same table later. The
 * database's exclusion constraint is the final guard against overlaps; the
 * pre-check exists to return a helpful 409 with the conflicting periods.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vehicles: VehiclesService,
    private readonly audit: AuditService,
  ) {}

  /** Holds of one of the provider's vehicles; defaults to current and upcoming ones. */
  async listHolds(
    providerId: string,
    vehicleId: string,
    query: HoldListQuery,
  ): Promise<VehicleHold[]> {
    await this.vehicles.getOwned(providerId, vehicleId);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - DAY_MS);
    const to = query.to ? new Date(query.to) : undefined;
    return this.db
      .select()
      .from(vehicleHolds)
      .where(
        and(
          eq(vehicleHolds.vehicleId, vehicleId),
          gt(vehicleHolds.endsAt, from),
          to ? lt(vehicleHolds.startsAt, to) : undefined,
        ),
      )
      .orderBy(asc(vehicleHolds.startsAt));
  }

  async availability(
    providerId: string,
    vehicleId: string,
    range: AvailabilityRangeQuery,
  ): Promise<VehicleAvailability> {
    const vehicle = await this.vehicles.getOwned(providerId, vehicleId);
    const from = new Date(range.from);
    const to = new Date(range.to);
    const holds = await this.overlapping(this.db, vehicleId, from, to);
    const bookable = isBookable(vehicle.status);
    return {
      vehicleId,
      status: vehicle.status,
      bookable,
      from: from.toISOString(),
      to: to.toISOString(),
      available: bookable && holds.length === 0,
      holds: holds.map(toHold),
    };
  }

  async createBlock(
    provider: ProviderProfile,
    vehicleId: string,
    input: CreateAvailabilityBlockRequest,
    meta: RequestMeta,
  ): Promise<VehicleHold> {
    const vehicle = await this.vehicles.getOwned(provider.id, vehicleId);
    if (!BLOCKABLE_STATUSES.includes(vehicle.status)) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `Availability can be managed once the vehicle is approved (it is ${vehicle.status.replace('_', ' ')})`,
        409,
      );
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt.getTime() <= Date.now()) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'endsAt', issue: 'the block is entirely in the past' },
      ]);
    }

    return this.db.transaction(async (tx) => {
      // Every hold writer (manual blocks here, booking acceptance in the booking
      // module) locks the vehicle row first, so competing writers serialise on it
      // instead of deadlocking on each other's uncommitted index entries.
      await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .for('update');
      const conflicts = await this.overlapping(tx, vehicleId, startsAt, endsAt);
      if (conflicts.length > 0) throw this.conflict(conflicts);

      let row: VehicleHold | undefined;
      try {
        [row] = await tx
          .insert(vehicleHolds)
          .values({
            vehicleId,
            startsAt,
            endsAt,
            kind: 'block',
            blockReason: input.reason,
            note: input.note ?? null,
            createdBy: provider.userId,
          })
          .returning();
      } catch (error) {
        // Lost a race with a concurrent insert: the constraint did its job.
        if (isExclusionViolation(error) || isDeadlock(error)) throw this.conflict([]);
        throw error;
      }
      if (!row) throw new Error('Failed to create availability block');

      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle_block.created',
          targetType: 'vehicle',
          targetId: vehicleId,
          ip: meta.ip ?? null,
          metadata: {
            holdId: row.id,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            reason: row.blockReason,
          },
        },
        tx,
      );
      return row;
    });
  }

  async deleteBlock(
    provider: ProviderProfile,
    vehicleId: string,
    blockId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.vehicles.getOwned(provider.id, vehicleId);
    await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(vehicleHolds)
        .where(
          and(
            eq(vehicleHolds.id, blockId),
            eq(vehicleHolds.vehicleId, vehicleId),
            eq(vehicleHolds.kind, 'block'),
          ),
        )
        .returning();
      if (!deleted) throw new ApiException('NOT_FOUND', 'Availability block not found', 404);
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle_block.deleted',
          targetType: 'vehicle',
          targetId: vehicleId,
          ip: meta.ip ?? null,
          metadata: {
            holdId: deleted.id,
            startsAt: deleted.startsAt.toISOString(),
            endsAt: deleted.endsAt.toISOString(),
            reason: deleted.blockReason,
          },
        },
        tx,
      );
    });
  }

  // ------------------------------------------------------------- helpers

  /** Holds whose half-open period intersects `[from, to)`. */
  private async overlapping(
    executor: DatabaseExecutor,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<VehicleHold[]> {
    return executor
      .select()
      .from(vehicleHolds)
      .where(
        and(
          eq(vehicleHolds.vehicleId, vehicleId),
          lt(vehicleHolds.startsAt, to),
          gt(vehicleHolds.endsAt, from),
        ),
      )
      .orderBy(asc(vehicleHolds.startsAt));
  }

  private conflict(conflicts: VehicleHold[]): ApiException {
    return new ApiException(
      'AVAILABILITY_CONFLICT',
      'The period overlaps an existing block for this vehicle',
      409,
      conflicts.map((c) => ({
        field: 'startsAt',
        issue: `overlaps ${c.kind} ${c.startsAt.toISOString()} – ${c.endsAt.toISOString()}`,
      })),
    );
  }
}
