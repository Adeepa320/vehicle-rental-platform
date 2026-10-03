import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminVehicleListQuery, VehicleStatus } from '@vrp/contracts';
import {
  providerLocations,
  providerProfiles,
  users,
  vehicles,
  type Database,
  type DatabaseExecutor,
  type NewVehicle,
  type ProviderLocation,
  type ProviderProfile,
  type User,
  type Vehicle,
} from '@vrp/database';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { ownerOf, vehicleLabel } from '../catalogue/catalogue.helpers';
import { ProviderLocationsService } from '../catalogue/provider-locations.service';
import { ADMIN_VEHICLE_TRANSITIONS, type AdminVehicleAction } from '../catalogue/vehicle.state';
import { VehiclesService } from '../catalogue/vehicles.service';
import { EmailService } from '../notifications/email/email.service';
import {
  vehicleApprovedEmail,
  vehicleChangesRequestedEmail,
  vehicleReactivatedEmail,
  vehicleRejectedEmail,
  vehicleSuspendedEmail,
} from '../notifications/email/vehicle-templates';

export interface AdminVehicleDetail {
  vehicle: Vehicle;
  provider: ProviderProfile;
  owner: Pick<User, 'id' | 'email' | 'fullName'>;
  location: ProviderLocation | null;
  locationVehicleCount: number;
}

/**
 * Admin review of vehicle listings, mirroring the provider-application review:
 * atomic status-conditioned transitions, an audit event and a provider e-mail
 * in the same transaction.
 */
@Injectable()
export class AdminVehicleReviewService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vehicles: VehiclesService,
    private readonly locations: ProviderLocationsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminVehicleReviewService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async list(query: AdminVehicleListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select({
        vehicle: vehicles,
        provider: { id: providerProfiles.id, displayName: providerProfiles.displayName },
      })
      .from(vehicles)
      .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
      .where(
        and(
          isNull(vehicles.deletedAt),
          query.status ? eq(vehicles.status, query.status) : undefined,
          query.providerId ? eq(vehicles.providerId, query.providerId) : undefined,
          cursor
            ? or(
                lt(vehicles.createdAt, cursor.createdAt),
                and(eq(vehicles.createdAt, cursor.createdAt), lt(vehicles.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(vehicles.createdAt), desc(vehicles.id))
      .limit(query.limit + 1);
    return paginate(
      rows.map((r) => ({ ...r, createdAt: r.vehicle.createdAt, id: r.vehicle.id })),
      query.limit,
    );
  }

  async get(id: string): Promise<AdminVehicleDetail> {
    const [row] = await this.db
      .select({
        vehicle: vehicles,
        provider: providerProfiles,
        owner: { id: users.id, email: users.email, fullName: users.fullName },
        location: providerLocations,
      })
      .from(vehicles)
      .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
      .innerJoin(users, eq(users.id, providerProfiles.userId))
      .leftJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
      .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);
    return {
      ...row,
      locationVehicleCount: row.location
        ? await this.locations.countVehiclesUsing(row.location.id)
        : 0,
    };
  }

  // ------------------------------------------------------- transitions

  async startReview(
    id: string,
    admin: AuthenticatedUser,
    input: { adminNotes?: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const vehicle = await this.transition(tx, id, 'start_review', admin, {
        reviewStartedAt: new Date(),
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      await this.audit.record(
        this.adminEvent(admin, 'vehicle.review_started', vehicle.id, meta),
        tx,
      );
      return vehicle;
    });
  }

  async requestChanges(
    id: string,
    admin: AuthenticatedUser,
    input: { reason: string; adminNotes?: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const vehicle = await this.transition(tx, id, 'request_changes', admin, {
        changesRequestedAt: new Date(),
        reviewReason: input.reason,
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      await this.audit.record(
        this.adminEvent(admin, 'vehicle.changes_requested', vehicle.id, meta, input.reason),
        tx,
      );
      const { owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.email.enqueue(
        vehicleChangesRequestedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: vehicleLabel(vehicle),
          reason: input.reason,
          link: `${this.webAppUrl}/provider/vehicles/${vehicle.id}`,
        }),
        tx,
      );
      return vehicle;
    });
  }

  async reject(
    id: string,
    admin: AuthenticatedUser,
    input: { reason: string; adminNotes?: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const vehicle = await this.transition(tx, id, 'reject', admin, {
        rejectedAt: new Date(),
        reviewReason: input.reason,
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      await this.audit.record(
        this.adminEvent(admin, 'vehicle.rejected', vehicle.id, meta, input.reason),
        tx,
      );
      const { owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.email.enqueue(
        vehicleRejectedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: vehicleLabel(vehicle),
          reason: input.reason,
        }),
        tx,
      );
      return vehicle;
    });
  }

  /** Approval re-checks completeness inside the transaction; incomplete data rolls back with 400. */
  async approve(
    id: string,
    admin: AuthenticatedUser,
    input: { adminNotes?: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const vehicle = await this.transition(tx, id, 'approve', admin, {
        approvedAt: new Date(),
        reviewReason: null,
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      const issues = await this.vehicles.completenessIssues(vehicle.providerId, vehicle);
      if (issues.length > 0) {
        throw new ApiException(
          'VALIDATION_ERROR',
          'The listing is incomplete and cannot be approved; request changes instead',
          400,
          issues,
        );
      }
      await this.audit.record(this.adminEvent(admin, 'vehicle.approved', vehicle.id, meta), tx);
      const { owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.email.enqueue(
        vehicleApprovedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: vehicleLabel(vehicle),
          link: `${this.webAppUrl}/provider/vehicles/${vehicle.id}/availability`,
        }),
        tx,
      );
      this.logger.info({ vehicleId: vehicle.id, adminId: admin.id }, 'Vehicle approved');
      return vehicle;
    });
  }

  async suspend(
    id: string,
    admin: AuthenticatedUser,
    input: { reason: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const vehicle = await this.transition(tx, id, 'suspend', admin, {
        suspendedAt: new Date(),
        suspensionReason: input.reason,
      });
      await this.audit.record(
        this.adminEvent(admin, 'vehicle.suspended', vehicle.id, meta, input.reason),
        tx,
      );
      const { owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.email.enqueue(
        vehicleSuspendedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: vehicleLabel(vehicle),
          reason: input.reason,
        }),
        tx,
      );
      return vehicle;
    });
  }

  async reactivate(
    id: string,
    admin: AuthenticatedUser,
    input: { note?: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const vehicle = await this.transition(tx, id, 'reactivate', admin, {
        suspendedAt: null,
        suspensionReason: null,
        deactivatedAt: null,
      });
      await this.audit.record(
        this.adminEvent(admin, 'vehicle.reactivated', vehicle.id, meta, input.note ?? null),
        tx,
      );
      const { owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.email.enqueue(
        vehicleReactivatedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: vehicleLabel(vehicle),
          link: `${this.webAppUrl}/provider/vehicles/${vehicle.id}`,
        }),
        tx,
      );
      return vehicle;
    });
  }

  // ------------------------------------------------------------- helpers

  private async transition(
    tx: DatabaseExecutor,
    id: string,
    action: AdminVehicleAction,
    admin: AuthenticatedUser,
    patch: Partial<NewVehicle>,
  ): Promise<Vehicle> {
    const { from, to } = ADMIN_VEHICLE_TRANSITIONS[action];
    const [updated] = await tx
      .update(vehicles)
      .set({ ...patch, status: to, reviewedAt: new Date(), reviewedBy: admin.id })
      .where(
        and(
          eq(vehicles.id, id),
          isNull(vehicles.deletedAt),
          inArray(vehicles.status, [...from] as VehicleStatus[]),
        ),
      )
      .returning();
    if (updated) return updated;

    const [current] = await tx
      .select({ status: vehicles.status })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)));
    if (!current) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);
    throw new ApiException(
      'INVALID_STATE_TRANSITION',
      `Cannot ${action.replace('_', ' ')} a vehicle that is ${current.status.replace('_', ' ')}`,
      409,
    );
  }

  private async ownerAndProvider(
    tx: DatabaseExecutor,
    providerId: string,
  ): Promise<{ provider: ProviderProfile; owner: Pick<User, 'email' | 'fullName'> }> {
    const [provider] = await tx
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, providerId));
    if (!provider) throw new ApiException('NOT_FOUND', 'Provider not found', 404);
    return { provider, owner: await ownerOf(tx, provider.userId) };
  }

  private adminEvent(
    admin: AuthenticatedUser,
    action: string,
    vehicleId: string,
    meta: RequestMeta,
    reason: string | null = null,
  ) {
    return {
      actorUserId: admin.id,
      actorType: 'admin' as const,
      action,
      targetType: 'vehicle',
      targetId: vehicleId,
      reason,
      ip: meta.ip ?? null,
    };
  }
}
