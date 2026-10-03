import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VEHICLE_IDENTITY_FIELDS,
  categoryApplicabilityIssues,
  pricingIssues,
  vehicleSubmissionIssues,
  type ApiErrorDetail,
  type CreateVehicleRequest,
  type UpdateVehicleRequest,
  type VehicleStatus,
} from '@vrp/contracts';
import {
  vehiclePhotos,
  vehicles,
  type Database,
  type DatabaseExecutor,
  type NewVehicle,
  type ProviderProfile,
  type Vehicle,
} from '@vrp/database';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.types';
import { EmailService } from '../notifications/email/email.service';
import {
  operatorNewVehicleEmail,
  vehicleSubmittedEmail,
} from '../notifications/email/vehicle-templates';
import { ReferenceService } from '../reference/reference.service';
import { isUniqueViolation } from '../users/users.service';
import { ownerOf, vehicleLabel } from './catalogue.helpers';
import { ProviderLocationsService } from './provider-locations.service';
import { vehicleFields } from './vehicle.mappers';
import {
  PROVIDER_VEHICLE_TRANSITIONS,
  editability,
  type ProviderVehicleAction,
} from './vehicle.state';

type WritablePatch = Partial<Omit<NewVehicle, 'id' | 'providerId' | 'status'>>;

/** Picks the defined writable fields of a request (names match the columns one-to-one). */
function columnsOf(input: Partial<UpdateVehicleRequest>): WritablePatch {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as WritablePatch;
}

/**
 * Provider-side vehicle listings. All reads and writes are scoped by the
 * caller's provider id, so another provider's vehicle is simply "not found".
 */
@Injectable()
export class VehiclesService {
  private readonly webAppUrl: string;
  private readonly operatorEmail: string | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reference: ReferenceService,
    private readonly locations: ProviderLocationsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VehiclesService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    this.operatorEmail = config.get('OPERATOR_NOTIFICATION_EMAIL', { infer: true });
  }

  async listMine(providerId: string): Promise<Vehicle[]> {
    return this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.providerId, providerId), isNull(vehicles.deletedAt)))
      .orderBy(desc(vehicles.createdAt), desc(vehicles.id));
  }

  /** 404 for unknown ids and for other providers' vehicles alike. */
  async getOwned(
    providerId: string,
    id: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Vehicle> {
    const [row] = await executor
      .select()
      .from(vehicles)
      .where(
        and(eq(vehicles.id, id), eq(vehicles.providerId, providerId), isNull(vehicles.deletedAt)),
      )
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);
    return row;
  }

  async create(
    provider: ProviderProfile,
    input: CreateVehicleRequest,
    meta: RequestMeta,
  ): Promise<Vehicle> {
    await this.assertReferences(provider.id, input);

    return this.db.transaction(async (tx) => {
      let row: Vehicle | undefined;
      try {
        [row] = await tx
          .insert(vehicles)
          .values({ ...columnsOf(input), providerId: provider.id, categoryId: input.categoryId })
          .returning();
      } catch (error) {
        this.rethrowDuplicatePlate(error);
      }
      if (!row) throw new Error('Failed to create vehicle');

      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle.created',
          targetType: 'vehicle',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { providerId: provider.id, categoryId: row.categoryId },
        },
        tx,
      );
      return row;
    });
  }

  /**
   * Draft / changes_requested: everything. Approved / inactive: operational
   * fields only (identity fields are reported as locked). Other states: 409.
   */
  async update(
    provider: ProviderProfile,
    id: string,
    patch: UpdateVehicleRequest,
    meta: RequestMeta,
  ): Promise<Vehicle> {
    const existing = await this.getOwned(provider.id, id);
    const mode = editability(existing.status);
    if (mode === 'none') {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `The vehicle cannot be edited while it is ${existing.status.replace('_', ' ')}`,
        409,
      );
    }
    const changes = columnsOf(patch);
    if (mode === 'operational') {
      const locked = Object.keys(changes).filter((key) =>
        (VEHICLE_IDENTITY_FIELDS as readonly string[]).includes(key),
      );
      if (locked.length > 0) {
        throw new ApiException(
          'VALIDATION_ERROR',
          'Identity fields are locked once a vehicle is approved; create a new listing to change them',
          400,
          locked.map((field) => ({ field, issue: 'locked after approval' })),
        );
      }
    }

    // Cross-field rules against the merged result (the schema only sees the patch).
    const merged = { ...vehicleFields(existing), ...changes };
    const crossIssues = [...pricingIssues(merged), ...categoryApplicabilityIssues(merged)];
    if (crossIssues.length > 0) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, crossIssues);
    }
    await this.assertReferences(provider.id, patch);

    return this.db.transaction(async (tx) => {
      let row: Vehicle | undefined;
      try {
        [row] = await tx
          .update(vehicles)
          .set(changes)
          .where(and(eq(vehicles.id, id), eq(vehicles.providerId, provider.id)))
          .returning();
      } catch (error) {
        this.rethrowDuplicatePlate(error);
      }
      if (!row) throw new ApiException('NOT_FOUND', 'Vehicle not found', 404);

      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle.updated',
          targetType: 'vehicle',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { providerId: provider.id, fields: Object.keys(changes) },
        },
        tx,
      );
      return row;
    });
  }

  /** Completeness is checked here and again by the admin on approval. */
  async submit(provider: ProviderProfile, id: string, meta: RequestMeta): Promise<Vehicle> {
    const existing = await this.getOwned(provider.id, id);
    if (!PROVIDER_VEHICLE_TRANSITIONS.submit.from.includes(existing.status)) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `The vehicle cannot be submitted while it is ${existing.status.replace('_', ' ')}`,
        409,
      );
    }
    const issues = await this.completenessIssues(provider.id, existing);
    if (issues.length > 0) {
      throw new ApiException(
        'VALIDATION_ERROR',
        'The listing is incomplete; fix the listed fields and submit again',
        400,
        issues,
      );
    }

    return this.db.transaction(async (tx) => {
      const row = await this.transition(tx, provider.id, id, 'submit', {
        submittedAt: new Date(),
        reviewReason: null,
      });
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle.submitted',
          targetType: 'vehicle',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { providerId: provider.id, categoryId: row.categoryId },
        },
        tx,
      );

      const owner = await ownerOf(tx, provider.userId);
      const label = vehicleLabel(row);
      await this.email.enqueue(
        vehicleSubmittedEmail({
          to: owner.email,
          fullName: owner.fullName,
          title: label,
          link: `${this.webAppUrl}/provider/vehicles/${row.id}`,
        }),
        tx,
      );
      if (this.operatorEmail) {
        await this.email.enqueue(
          operatorNewVehicleEmail({
            to: this.operatorEmail,
            title: label,
            providerName: provider.displayName,
            reviewLink: `${this.webAppUrl}/admin/vehicles/${row.id}`,
          }),
          tx,
        );
      }
      this.logger.info({ vehicleId: row.id, providerId: provider.id }, 'Vehicle submitted');
      return row;
    });
  }

  async deactivate(provider: ProviderProfile, id: string, meta: RequestMeta): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const row = await this.transition(tx, provider.id, id, 'deactivate', {
        deactivatedAt: new Date(),
      });
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle.deactivated',
          targetType: 'vehicle',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { providerId: provider.id },
        },
        tx,
      );
      return row;
    });
  }

  async activate(provider: ProviderProfile, id: string, meta: RequestMeta): Promise<Vehicle> {
    return this.db.transaction(async (tx) => {
      const row = await this.transition(tx, provider.id, id, 'activate', { deactivatedAt: null });
      await this.audit.record(
        {
          actorUserId: provider.userId,
          actorType: 'provider',
          action: 'vehicle.activated',
          targetType: 'vehicle',
          targetId: row.id,
          ip: meta.ip ?? null,
          metadata: { providerId: provider.id },
        },
        tx,
      );
      return row;
    });
  }

  /** Submission checklist plus the live state of the referenced location. */
  async completenessIssues(providerId: string, row: Vehicle): Promise<ApiErrorDetail[]> {
    const issues = vehicleSubmissionIssues(vehicleFields(row), {
      photoCount: await this.countPhotos(row.id),
    });
    if (row.locationId && !(await this.locations.isUsable(providerId, row.locationId))) {
      issues.push({ field: 'locationId', issue: 'the pickup location is inactive' });
    }
    return issues;
  }

  /** Active photos; the submission checklist requires `MIN_VEHICLE_PHOTOS` of them. */
  async countPhotos(vehicleId: string, executor: DatabaseExecutor = this.db): Promise<number> {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(vehiclePhotos)
      .where(and(eq(vehiclePhotos.vehicleId, vehicleId), isNull(vehiclePhotos.deletedAt)));
    return row?.count ?? 0;
  }

  // ------------------------------------------------------------- helpers

  private async assertReferences(
    providerId: string,
    input: Partial<UpdateVehicleRequest>,
  ): Promise<void> {
    const issues: ApiErrorDetail[] = [];
    if (input.categoryId !== undefined) {
      issues.push(...(await this.reference.validateCategory(input.categoryId)));
    }
    if (
      input.locationId !== undefined &&
      !(await this.locations.isUsable(providerId, input.locationId))
    ) {
      issues.push({ field: 'locationId', issue: 'unknown or inactive location' });
    }
    if (issues.length > 0) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, issues);
    }
  }

  private rethrowDuplicatePlate(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw new ApiException(
        'CONFLICT',
        'Another of your vehicles already uses this registration number',
        409,
        [{ field: 'registrationNumber', issue: 'already used by one of your vehicles' }],
      );
    }
    throw error;
  }

  private async transition(
    tx: DatabaseExecutor,
    providerId: string,
    id: string,
    action: ProviderVehicleAction,
    patch: WritablePatch &
      Partial<Pick<NewVehicle, 'submittedAt' | 'deactivatedAt' | 'reviewReason'>>,
  ): Promise<Vehicle> {
    const { from, to } = PROVIDER_VEHICLE_TRANSITIONS[action];
    const [updated] = await tx
      .update(vehicles)
      .set({ ...patch, status: to })
      .where(
        and(
          eq(vehicles.id, id),
          eq(vehicles.providerId, providerId),
          isNull(vehicles.deletedAt),
          inArray(vehicles.status, [...from] as VehicleStatus[]),
        ),
      )
      .returning();
    if (updated) return updated;

    const current = await this.getOwned(providerId, id, tx);
    throw new ApiException(
      'INVALID_STATE_TRANSITION',
      `Cannot ${action} a vehicle that is ${current.status.replace('_', ' ')}`,
      409,
    );
  }
}
