import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderApplicationRequiredSchema,
  type AdminProviderApplicationListQuery,
  type AdminProviderListQuery,
  type ProviderApplicationStatus,
  type ProviderStatus,
} from '@vrp/contracts';
import {
  providerApplications,
  providerProfiles,
  providerServiceAreas,
  providerVehicleCategories,
  users,
  type Database,
  type ProviderApplication,
  type ProviderProfile,
  type User,
} from '@vrp/database';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { EmailService } from '../notifications/email/email.service';
import {
  providerApprovedEmail,
  providerChangesRequestedEmail,
  providerReactivatedEmail,
  providerRejectedEmail,
  providerSuspendedEmail,
} from '../notifications/email/templates';
import { ADMIN_TRANSITIONS, type AdminAction } from '../providers/provider-application.state';
import { applicationFields, type ProfileRelations } from '../providers/provider.mappers';
import { ProvidersService } from '../providers/providers.service';
import { isUniqueViolation } from '../users/users.service';

type ApplicantColumns = Pick<User, 'id' | 'email' | 'fullName' | 'emailVerifiedAt' | 'createdAt'>;

const applicantColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  emailVerifiedAt: users.emailVerifiedAt,
  createdAt: users.createdAt,
};

/**
 * Admin-side review of provider applications and standing of approved
 * providers. Every decision is an atomic, status-conditioned update plus an
 * audit event and an applicant e-mail in the same transaction.
 */
@Injectable()
export class AdminReviewService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly providers: ProvidersService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminReviewService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ------------------------------------------------------------- listing

  async listApplications(query: AdminProviderApplicationListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select({ application: providerApplications, applicant: applicantColumns })
      .from(providerApplications)
      .innerJoin(users, eq(users.id, providerApplications.userId))
      .where(
        and(
          query.status ? eq(providerApplications.status, query.status) : undefined,
          cursor
            ? or(
                lt(providerApplications.createdAt, cursor.createdAt),
                and(
                  eq(providerApplications.createdAt, cursor.createdAt),
                  lt(providerApplications.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(providerApplications.createdAt), desc(providerApplications.id))
      .limit(query.limit + 1);
    return paginate(
      rows.map((r) => ({ ...r, createdAt: r.application.createdAt, id: r.application.id })),
      query.limit,
    );
  }

  async getApplication(
    id: string,
  ): Promise<{ application: ProviderApplication; applicant: ApplicantColumns }> {
    const [row] = await this.db
      .select({ application: providerApplications, applicant: applicantColumns })
      .from(providerApplications)
      .innerJoin(users, eq(users.id, providerApplications.userId))
      .where(eq(providerApplications.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Provider application not found', 404);
    return row;
  }

  async listProviders(query: AdminProviderListQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select({
        profile: providerProfiles,
        owner: { id: users.id, email: users.email, fullName: users.fullName },
      })
      .from(providerProfiles)
      .innerJoin(users, eq(users.id, providerProfiles.userId))
      .where(
        and(
          query.status ? eq(providerProfiles.status, query.status) : undefined,
          cursor
            ? or(
                lt(providerProfiles.createdAt, cursor.createdAt),
                and(
                  eq(providerProfiles.createdAt, cursor.createdAt),
                  lt(providerProfiles.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(providerProfiles.createdAt), desc(providerProfiles.id))
      .limit(query.limit + 1);
    return paginate(
      rows.map((r) => ({ ...r, createdAt: r.profile.createdAt, id: r.profile.id })),
      query.limit,
    );
  }

  async getProvider(id: string): Promise<{
    profile: ProviderProfile;
    relations: ProfileRelations;
    owner: Pick<User, 'id' | 'email' | 'fullName'>;
  }> {
    const [row] = await this.db
      .select({
        profile: providerProfiles,
        owner: { id: users.id, email: users.email, fullName: users.fullName },
      })
      .from(providerProfiles)
      .innerJoin(users, eq(users.id, providerProfiles.userId))
      .where(eq(providerProfiles.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Provider not found', 404);
    return { ...row, relations: await this.providers.relationsFor(row.profile.id) };
  }

  // ------------------------------------------------------- transitions

  async startReview(
    id: string,
    admin: AuthenticatedUser,
    input: { adminNotes?: string },
    meta: RequestMeta,
  ): Promise<ProviderApplication> {
    return this.db.transaction(async (tx) => {
      const application = await this.transition(tx, id, 'start_review', admin, {
        reviewStartedAt: new Date(),
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      await this.audit.record(
        this.adminEvent(admin, 'provider_application.review_started', application.id, meta),
        tx,
      );
      return application;
    });
  }

  async requestChanges(
    id: string,
    admin: AuthenticatedUser,
    input: { reason: string; adminNotes?: string },
    meta: RequestMeta,
  ): Promise<ProviderApplication> {
    return this.db.transaction(async (tx) => {
      const application = await this.transition(tx, id, 'request_changes', admin, {
        changesRequestedAt: new Date(),
        reviewReason: input.reason,
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      await this.audit.record(
        this.adminEvent(
          admin,
          'provider_application.changes_requested',
          application.id,
          meta,
          input.reason,
        ),
        tx,
      );
      const applicant = await this.applicantOf(tx, application.userId);
      await this.email.enqueue(
        providerChangesRequestedEmail({
          to: applicant.email,
          fullName: applicant.fullName,
          displayName: application.displayName ?? 'your application',
          reason: input.reason,
          link: `${this.webAppUrl}/provider/application`,
        }),
        tx,
      );
      return application;
    });
  }

  async reject(
    id: string,
    admin: AuthenticatedUser,
    input: { reason: string; adminNotes?: string },
    meta: RequestMeta,
  ): Promise<ProviderApplication> {
    return this.db.transaction(async (tx) => {
      const application = await this.transition(tx, id, 'reject', admin, {
        rejectedAt: new Date(),
        reviewReason: input.reason,
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });
      await this.audit.record(
        this.adminEvent(admin, 'provider_application.rejected', application.id, meta, input.reason),
        tx,
      );
      const applicant = await this.applicantOf(tx, application.userId);
      await this.email.enqueue(
        providerRejectedEmail({
          to: applicant.email,
          fullName: applicant.fullName,
          displayName: application.displayName ?? 'your application',
          reason: input.reason,
        }),
        tx,
      );
      return application;
    });
  }

  /**
   * Approval is one transaction: application → approved, profile + relation rows
   * created, `provider` role appended (other roles untouched), audit, e-mail.
   * A second approval finds no row in an approvable status and fails with 409.
   */
  async approve(
    id: string,
    admin: AuthenticatedUser,
    input: { adminNotes?: string },
    meta: RequestMeta,
  ): Promise<{ application: ProviderApplication; profile: ProviderProfile }> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const application = await this.transition(tx, id, 'approve', admin, {
        approvedAt: now,
        reviewReason: null,
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
      });

      // Defensive: the data must still satisfy the submission rules.
      const required = ProviderApplicationRequiredSchema.safeParse(applicationFields(application));
      if (!required.success) {
        throw new ApiException(
          'VALIDATION_ERROR',
          'The application is incomplete and cannot be approved; request changes instead',
          400,
          required.error.issues.map((i) => ({
            field: i.path.map(String).join('.'),
            issue: i.message,
          })),
        );
      }
      const data = required.data;

      let profile: ProviderProfile | undefined;
      for (let attempt = 0; attempt < 5 && !profile; attempt += 1) {
        try {
          [profile] = await tx
            .insert(providerProfiles)
            .values({
              userId: application.userId,
              applicationId: application.id,
              slug: makeSlug(data.displayName),
              displayName: data.displayName,
              providerType: data.providerType,
              contactName: data.contactName,
              phoneE164: data.phone,
              whatsappE164: application.whatsappE164,
              description: application.description,
              addressText: data.addressText,
              districtId: data.districtId,
              primaryPlaceId: data.primaryPlaceId,
              yearsOperating: application.yearsOperating,
              fleetSizeEstimate: application.fleetSizeEstimate,
              offersDelivery: application.offersDelivery,
              offersAirportTransfer: application.offersAirportTransfer,
              websiteUrl: application.websiteUrl,
              status: 'active',
              approvedAt: now,
              approvedBy: admin.id,
            })
            .returning();
        } catch (error) {
          // Only a slug collision is retried; a duplicate user/application profile is a real conflict.
          if (
            !isUniqueViolation(error) ||
            !String(
              (error as { cause?: { constraint_name?: string } }).cause?.constraint_name,
            ).includes('slug')
          ) {
            throw error;
          }
        }
      }
      if (!profile) throw new Error('Could not allocate a unique provider slug');

      const areaIds = [...new Set(application.serviceAreaPlaceIds)].filter(
        (placeId) => placeId !== data.primaryPlaceId,
      );
      if (areaIds.length > 0) {
        await tx
          .insert(providerServiceAreas)
          .values(areaIds.map((placeId) => ({ providerId: profile!.id, placeId })));
      }
      await tx.insert(providerVehicleCategories).values(
        [...new Set(data.vehicleCategoryIds)].map((categoryId) => ({
          providerId: profile!.id,
          categoryId,
        })),
      );

      await tx
        .update(users)
        .set({ roles: sql`array_append(${users.roles}, 'provider'::user_role)` })
        .where(and(eq(users.id, application.userId), sql`not ('provider' = any(${users.roles}))`));

      await this.audit.record(
        this.adminEvent(admin, 'provider_application.approved', application.id, meta, null, {
          profileId: profile.id,
        }),
        tx,
      );

      const applicant = await this.applicantOf(tx, application.userId);
      await this.email.enqueue(
        providerApprovedEmail({
          to: applicant.email,
          fullName: applicant.fullName,
          displayName: profile.displayName,
          dashboardLink: `${this.webAppUrl}/provider/dashboard`,
        }),
        tx,
      );

      this.logger.info(
        { applicationId: application.id, profileId: profile.id, adminId: admin.id },
        'Provider application approved',
      );
      return { application, profile };
    });
  }

  async suspend(
    providerId: string,
    admin: AuthenticatedUser,
    input: { reason: string },
    meta: RequestMeta,
  ): Promise<ProviderProfile> {
    return this.db.transaction(async (tx) => {
      const profile = await this.setStanding(tx, providerId, 'active', {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedBy: admin.id,
        suspensionReason: input.reason,
      });
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'provider_profile.suspended',
          targetType: 'provider_profile',
          targetId: profile.id,
          reason: input.reason,
          ip: meta.ip ?? null,
        },
        tx,
      );
      const owner = await this.applicantOf(tx, profile.userId);
      await this.email.enqueue(
        providerSuspendedEmail({
          to: owner.email,
          fullName: owner.fullName,
          displayName: profile.displayName,
          reason: input.reason,
        }),
        tx,
      );
      return profile;
    });
  }

  async reactivate(
    providerId: string,
    admin: AuthenticatedUser,
    input: { note?: string },
    meta: RequestMeta,
  ): Promise<ProviderProfile> {
    return this.db.transaction(async (tx) => {
      const profile = await this.setStanding(tx, providerId, 'suspended', {
        status: 'active',
        reactivatedAt: new Date(),
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
      });
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'provider_profile.reactivated',
          targetType: 'provider_profile',
          targetId: profile.id,
          reason: input.note ?? null,
          ip: meta.ip ?? null,
        },
        tx,
      );
      const owner = await this.applicantOf(tx, profile.userId);
      await this.email.enqueue(
        providerReactivatedEmail({
          to: owner.email,
          fullName: owner.fullName,
          displayName: profile.displayName,
          dashboardLink: `${this.webAppUrl}/provider/dashboard`,
        }),
        tx,
      );
      return profile;
    });
  }

  // ------------------------------------------------------------- helpers

  /** Status-conditioned update; 404 when unknown, 409 when the transition is not allowed. */
  private async transition(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    id: string,
    action: AdminAction,
    admin: AuthenticatedUser,
    patch: Partial<typeof providerApplications.$inferInsert>,
  ): Promise<ProviderApplication> {
    const { from, to } = ADMIN_TRANSITIONS[action];
    const [updated] = await tx
      .update(providerApplications)
      .set({ ...patch, status: to, reviewedAt: new Date(), reviewedBy: admin.id })
      .where(
        and(
          eq(providerApplications.id, id),
          inArray(providerApplications.status, [...from] as ProviderApplicationStatus[]),
        ),
      )
      .returning();
    if (updated) return updated;

    const [current] = await tx
      .select({ status: providerApplications.status })
      .from(providerApplications)
      .where(eq(providerApplications.id, id));
    if (!current) throw new ApiException('NOT_FOUND', 'Provider application not found', 404);
    throw new ApiException(
      'INVALID_STATE_TRANSITION',
      `Cannot ${action.replace('_', ' ')} an application that is ${current.status.replace('_', ' ')}`,
      409,
    );
  }

  private async setStanding(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    providerId: string,
    expected: ProviderStatus,
    patch: Partial<typeof providerProfiles.$inferInsert>,
  ): Promise<ProviderProfile> {
    const [updated] = await tx
      .update(providerProfiles)
      .set(patch)
      .where(and(eq(providerProfiles.id, providerId), eq(providerProfiles.status, expected)))
      .returning();
    if (updated) return updated;
    const existing = await this.providers.findById(providerId);
    if (!existing) throw new ApiException('NOT_FOUND', 'Provider not found', 404);
    throw new ApiException(
      'INVALID_STATE_TRANSITION',
      `Provider is already ${existing.status}`,
      409,
    );
  }

  private async applicantOf(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    userId: string,
  ): Promise<Pick<User, 'email' | 'fullName'>> {
    const [row] = await tx
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) throw new ApiException('NOT_FOUND', 'Applicant not found', 404);
    return row;
  }

  private adminEvent(
    admin: AuthenticatedUser,
    action: string,
    applicationId: string,
    meta: RequestMeta,
    reason: string | null = null,
    metadata?: Record<string, unknown>,
  ) {
    return {
      actorUserId: admin.id,
      actorType: 'admin' as const,
      action,
      targetType: 'provider_application',
      targetId: applicationId,
      reason,
      ip: meta.ip ?? null,
      ...(metadata ? { metadata } : {}),
    };
  }
}

/** URL slug from the display name plus a short random suffix to avoid collisions. */
export function makeSlug(displayName: string): string {
  const base =
    displayName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'provider';
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${base}-${suffix}`;
}
