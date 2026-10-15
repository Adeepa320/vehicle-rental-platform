import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MIN_VEHICLE_PHOTOS,
  OPEN_BOOKING_STATUSES,
  type AdminVehicleListQuery,
  type AdminVehicleOperations,
  type CorrectVehicleCategoryRequest,
  type VehicleStatus,
} from '@vrp/contracts';
import {
  auditEvents,
  bookings,
  places,
  providerLocations,
  providerProfiles,
  users,
  vehicleCategories,
  vehicles,
  type Database,
  type DatabaseExecutor,
  type NewVehicle,
  type ProviderLocation,
  type ProviderProfile,
  type User,
  type Vehicle,
} from '@vrp/database';
import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { makeVehicleSlug, ownerOf, vehicleLabel } from '../catalogue/catalogue.helpers';
import { ProviderLocationsService } from '../catalogue/provider-locations.service';
import { VehiclePhotosService } from '../catalogue/vehicle-photos.service';
import { ADMIN_VEHICLE_TRANSITIONS, type AdminVehicleAction } from '../catalogue/vehicle.state';
import { VehiclesService } from '../catalogue/vehicles.service';
import { searchableCondition } from '../discovery/searchable';
import { DocumentsService } from '../documents/documents.service';
import {
  vehicleCategoryCorrectedEmail,
  vehiclePhotoRemovedEmail,
} from '../notifications/email/admin-templates';
import { EmailService } from '../notifications/email/email.service';
import {
  vehicleApprovedEmail,
  vehicleChangesRequestedEmail,
  vehicleReactivatedEmail,
  vehicleRejectedEmail,
  vehicleSuspendedEmail,
} from '../notifications/email/vehicle-templates';
import { NotificationsService } from '../notifications/inapp/notifications.service';
import { ReferenceService } from '../reference/reference.service';

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
    private readonly photos: VehiclePhotosService,
    private readonly documents: DocumentsService,
    private readonly reference: ReferenceService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminVehicleReviewService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async list(query: AdminVehicleListQuery) {
    const cursor = decodeCursor(query.cursor);
    const q = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
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
          query.categoryId ? eq(vehicles.categoryId, query.categoryId) : undefined,
          query.placeId
            ? sql`exists (select 1 from ${providerLocations} l where l.id = ${vehicles.locationId} and l.place_id = ${query.placeId})`
            : undefined,
          q
            ? or(
                ilike(vehicles.title, q),
                ilike(vehicles.make, q),
                ilike(vehicles.model, q),
                ilike(vehicles.registrationNumber, q),
                ilike(providerProfiles.displayName, q),
              )
            : undefined,
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
      let vehicle = await this.transition(tx, id, 'approve', admin, {
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
      vehicle = await this.ensureSlug(tx, vehicle);
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
      const { provider, owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.notifications.create(tx, {
        userId: provider.userId,
        type: 'vehicle.suspended',
        title: `${vehicleLabel(vehicle)} was paused by the platform team`,
        body: `The listing is no longer shown to customers. Reason: ${input.reason}`,
        linkPath: `/provider/vehicles/${vehicle.id}`,
        metadata: { vehicleId: vehicle.id },
        dedupeKey: `vehicle:${vehicle.id}:suspended:${Date.now()}`,
      });
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

  /**
   * `suspended → approved`, only when the listing can actually be offered
   * again (Phase 9): the provider is active, the photo minimum is met and no
   * approved revenue licence / insurance has lapsed. Otherwise 409 with the
   * list of what to fix, so a paused listing never silently reappears.
   */
  async reactivate(
    id: string,
    admin: AuthenticatedUser,
    input: { note?: string },
    meta: RequestMeta,
  ): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const detail = await this.get(id);
      const issues: string[] = [];
      if (detail.provider.status !== 'active') issues.push('the provider is suspended');
      const photoCount = await this.vehicles.countPhotos(id, tx);
      if (photoCount < MIN_VEHICLE_PHOTOS) {
        issues.push(`the listing has ${photoCount} of the ${MIN_VEHICLE_PHOTOS} photos required`);
      }
      const documents = await this.documents.verificationForVehicle(id, tx);
      if (documents.expired.length > 0) {
        issues.push(`expired document(s): ${documents.expired.join(', ')}`);
      }
      if (issues.length > 0) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `The listing cannot be reactivated yet: ${issues.join('; ')}`,
          409,
          issues.map((issue) => ({ field: 'vehicle', issue })),
        );
      }
      const vehicle = await this.transition(tx, id, 'reactivate', admin, {
        suspendedAt: null,
        suspensionReason: null,
        deactivatedAt: null,
      });
      await this.audit.record(
        this.adminEvent(admin, 'vehicle.reactivated', vehicle.id, meta, input.note ?? null),
        tx,
      );
      const { provider, owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.notifications.create(tx, {
        userId: provider.userId,
        type: 'vehicle.reactivated',
        title: `${vehicleLabel(vehicle)} is active again`,
        body: 'The pause has been lifted; the listing is shown to customers again unless you block dates.',
        linkPath: `/provider/vehicles/${vehicle.id}`,
        metadata: { vehicleId: vehicle.id },
        dedupeKey: `vehicle:${vehicle.id}:reactivated:${Date.now()}`,
      });
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

  /** Moves a listing to another existing, active category (Phase 9); never creates categories. */
  async correctCategory(
    id: string,
    admin: AuthenticatedUser,
    input: CorrectVehicleCategoryRequest,
    meta: RequestMeta,
  ): Promise<Vehicle> {
    const issues = await this.reference.validateCategory(input.categoryId);
    if (issues.length > 0) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, issues);
    }
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)))
        .for('update');
      if (!current) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);
      if (current.status === 'rejected') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'A rejected listing is not corrected',
          409,
        );
      }
      if (current.categoryId === input.categoryId) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          { field: 'categoryId', issue: 'the listing is already in this category' },
        ]);
      }
      const [vehicle] = await tx
        .update(vehicles)
        .set({ categoryId: input.categoryId, reviewedAt: new Date(), reviewedBy: admin.id })
        .where(eq(vehicles.id, id))
        .returning();
      if (!vehicle) throw new Error('Failed to update vehicle');
      await this.audit.record(
        {
          ...this.adminEvent(admin, 'vehicle.category_corrected', vehicle.id, meta, input.reason),
          metadata: { from: current.categoryId, to: input.categoryId },
        },
        tx,
      );
      const names = new Map(
        (
          await tx
            .select({ id: vehicleCategories.id, name: vehicleCategories.name })
            .from(vehicleCategories)
            .where(inArray(vehicleCategories.id, [current.categoryId, input.categoryId]))
        ).map((c) => [c.id, c.name]),
      );
      const { provider, owner } = await this.ownerAndProvider(tx, vehicle.providerId);
      await this.notifications.create(tx, {
        userId: provider.userId,
        type: 'vehicle.category_corrected',
        title: `${vehicleLabel(vehicle)} moved to ${names.get(input.categoryId) ?? input.categoryId}`,
        body: `Our team corrected the category from ${names.get(current.categoryId) ?? current.categoryId}. Reason: ${input.reason}`,
        linkPath: `/provider/vehicles/${vehicle.id}`,
        metadata: { vehicleId: vehicle.id },
        dedupeKey: `vehicle:${vehicle.id}:category:${Date.now()}`,
      });
      await this.email.enqueue(
        vehicleCategoryCorrectedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: vehicleLabel(vehicle),
          fromCategory: names.get(current.categoryId) ?? current.categoryId,
          toCategory: names.get(input.categoryId) ?? input.categoryId,
          reason: input.reason,
          link: `${this.webAppUrl}/provider/vehicles/${vehicle.id}`,
        }),
        tx,
      );
      return vehicle;
    });
  }

  /**
   * Removes a photo for policy reasons (Phase 9). When a live listing drops
   * below the photo minimum it is handed back to the provider as
   * `changes_requested` (new photos + re-review) — it would be invisible by
   * the searchable predicate anyway, and providers can only change photos
   * while a listing is editable (TECH_DECISIONS D43).
   */
  async removePhoto(
    id: string,
    photoId: string,
    admin: AuthenticatedUser,
    input: { reason: string },
    meta: RequestMeta,
  ): Promise<{ remaining: number; sentBackForChanges: boolean }> {
    const detail = await this.get(id);
    const { remaining } = await this.photos.removeByAdmin(admin, id, photoId, input.reason, meta);
    const belowMinimum = remaining < MIN_VEHICLE_PHOTOS;
    const canSendBack = ADMIN_VEHICLE_TRANSITIONS.moderate_photos.from.includes(
      detail.vehicle.status,
    );
    let sentBackForChanges = false;
    await this.db.transaction(async (tx) => {
      if (belowMinimum && canSendBack) {
        const reason = `A photo was removed by the platform team (${input.reason}). Upload at least ${MIN_VEHICLE_PHOTOS} photos and resubmit the listing for review.`;
        await this.transition(tx, id, 'moderate_photos', admin, {
          changesRequestedAt: new Date(),
          reviewReason: reason,
          suspendedAt: null,
          suspensionReason: null,
        });
        await this.audit.record(
          this.adminEvent(admin, 'vehicle.changes_requested', id, meta, reason),
          tx,
        );
        sentBackForChanges = true;
      }
      await this.notifications.create(tx, {
        userId: detail.provider.userId,
        type: 'vehicle.photo_removed',
        title: `A photo was removed from ${vehicleLabel(detail.vehicle)}`,
        body: belowMinimum
          ? `Reason: ${input.reason}. The listing now has ${remaining} photo(s) and needs ${MIN_VEHICLE_PHOTOS}; ${
              sentBackForChanges
                ? 'it was taken off search — upload new photos and resubmit it for review.'
                : 'upload the missing photos before resubmitting.'
            }`
          : `Reason: ${input.reason}. The listing still has ${remaining} photos and stays visible.`,
        linkPath: `/provider/vehicles/${detail.vehicle.id}`,
        metadata: { vehicleId: detail.vehicle.id, photoId },
        dedupeKey: `vehicle:${detail.vehicle.id}:photo-removed:${photoId}`,
      });
      await this.email.enqueue(
        vehiclePhotoRemovedEmail({
          to: detail.owner.email,
          fullName: detail.owner.fullName,
          title: vehicleLabel(detail.vehicle),
          reason: input.reason,
          remainingPhotos: remaining,
          minimumPhotos: MIN_VEHICLE_PHOTOS,
          link: `${this.webAppUrl}/provider/vehicles/${detail.vehicle.id}`,
        }),
        tx,
      );
    });
    return { remaining, sentBackForChanges };
  }

  /** The operational panel next to a listing (Phase 9): searchability, documents, open bookings. */
  async operations(detail: AdminVehicleDetail): Promise<AdminVehicleOperations> {
    const v = detail.vehicle;
    const [photoCount, documents, searchableRow, openRow, autoPauseRow] = await Promise.all([
      this.vehicles.countPhotos(v.id),
      this.documents.verificationForVehicle(v.id),
      this.db
        .select({ id: vehicles.id })
        .from(vehicles)
        .innerJoin(providerProfiles, eq(providerProfiles.id, vehicles.providerId))
        .innerJoin(providerLocations, eq(providerLocations.id, vehicles.locationId))
        .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
        .where(and(eq(vehicles.id, v.id), searchableCondition()))
        .limit(1)
        .then((r) => r[0]),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(
          and(eq(bookings.vehicleId, v.id), inArray(bookings.status, [...OPEN_BOOKING_STATUSES])),
        )
        .then((r) => r[0]),
      v.suspendedAt
        ? this.db
            .select({ createdAt: auditEvents.createdAt })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.targetType, 'vehicle'),
                eq(auditEvents.targetId, v.id),
                eq(auditEvents.action, 'vehicle.auto_paused'),
                gte(auditEvents.createdAt, v.suspendedAt),
              ),
            )
            .orderBy(desc(auditEvents.createdAt))
            .limit(1)
            .then((r) => r[0])
        : Promise.resolve(undefined),
    ]);
    const issues: string[] = [];
    if (v.status !== 'approved') issues.push(`listing status is ${v.status.replaceAll('_', ' ')}`);
    if (!v.slug) issues.push('no public slug yet (assigned on first approval)');
    if (detail.provider.status !== 'active') issues.push('provider is suspended');
    if (!detail.location) issues.push('no pickup location');
    else if (!detail.location.isActive) issues.push('pickup location is inactive');
    const [category] = await this.db
      .select({ isActive: vehicleCategories.isActive })
      .from(vehicleCategories)
      .where(eq(vehicleCategories.id, v.categoryId));
    if (category && !category.isActive) issues.push('category is inactive');
    if (photoCount < MIN_VEHICLE_PHOTOS) {
      issues.push(`${photoCount} of ${MIN_VEHICLE_PHOTOS} required photos`);
    }
    return {
      publiclySearchable: searchableRow !== undefined,
      searchabilityIssues: searchableRow ? [] : issues,
      photoCount,
      minimumPhotos: MIN_VEHICLE_PHOTOS,
      documents,
      openBookings: openRow?.count ?? 0,
      autoPausedAt: autoPauseRow ? autoPauseRow.createdAt.toISOString() : null,
      suspensionReason: v.suspensionReason,
    };
  }

  // ------------------------------------------------------------- helpers

  /**
   * Public slug assigned on first approval and stable afterwards (TECH_DECISIONS
   * D45). Candidates are checked before writing because a unique violation
   * would abort the surrounding transaction; the unique index stays the guard.
   */
  private async ensureSlug(tx: DatabaseExecutor, vehicle: Vehicle): Promise<Vehicle> {
    if (vehicle.slug) return vehicle;
    const [place] = vehicle.locationId
      ? await tx
          .select({ slug: places.slug })
          .from(providerLocations)
          .innerJoin(places, eq(places.id, providerLocations.placeId))
          .where(eq(providerLocations.id, vehicle.locationId))
      : [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = makeVehicleSlug(vehicle, place?.slug ?? null);
      const [taken] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.slug, candidate))
        .limit(1);
      if (taken) continue;
      const [updated] = await tx
        .update(vehicles)
        .set({ slug: candidate })
        .where(eq(vehicles.id, vehicle.id))
        .returning();
      if (updated) return updated;
    }
    throw new Error('Could not allocate a unique vehicle slug');
  }

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
