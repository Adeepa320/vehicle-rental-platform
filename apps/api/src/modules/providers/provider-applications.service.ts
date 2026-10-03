import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CURRENT_PROVIDER_AGREEMENT_VERSION,
  ProviderApplicationRequiredSchema,
  type ApiErrorDetail,
  type ProviderApplicationDraft,
} from '@vrp/contracts';
import { providerApplications, type Database, type ProviderApplication } from '@vrp/database';
import { and, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.types';
import { EmailService } from '../notifications/email/email.service';
import {
  operatorNewApplicationEmail,
  providerApplicationReceivedEmail,
} from '../notifications/email/templates';
import { ReferenceService } from '../reference/reference.service';
import { UsersService } from '../users/users.service';
import { APPLICANT_TRANSITIONS, canApplicant, isEditable } from './provider-application.state';
import { applicationFields } from './provider.mappers';

@Injectable()
export class ProviderApplicationsService {
  private readonly webAppUrl: string;
  private readonly operatorEmail: string | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reference: ReferenceService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProviderApplicationsService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    this.operatorEmail = config.get('OPERATOR_NOTIFICATION_EMAIL', { infer: true });
  }

  async findByUserId(userId: string): Promise<ProviderApplication | undefined> {
    const [row] = await this.db
      .select()
      .from(providerApplications)
      .where(eq(providerApplications.userId, userId))
      .limit(1);
    return row;
  }

  async getMineOrThrow(userId: string): Promise<ProviderApplication> {
    const row = await this.findByUserId(userId);
    if (!row)
      throw new ApiException('NOT_FOUND', 'You have not started a provider application', 404);
    return row;
  }

  /**
   * Creates the applicant's draft or updates it while it is editable. Review
   * fields and status are never writable here (strict schema + explicit set).
   */
  async upsertDraft(userId: string, input: ProviderApplicationDraft): Promise<ProviderApplication> {
    const existing = await this.findByUserId(userId);
    if (existing && !isEditable(existing.status)) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `The application cannot be edited while it is ${existing.status.replace('_', ' ')}`,
        409,
      );
    }

    const issues = await this.reference.validateApplicationReferences({
      districtId: input.districtId,
      primaryPlaceId: input.primaryPlaceId,
      serviceAreaPlaceIds: input.serviceAreaPlaceIds,
      vehicleCategoryIds: input.vehicleCategoryIds,
    });
    if (issues.length > 0) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, issues);
    }

    const values = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.providerType !== undefined ? { providerType: input.providerType } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.phone !== undefined ? { phoneE164: input.phone } : {}),
      ...(input.whatsapp !== undefined ? { whatsappE164: input.whatsapp } : {}),
      ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
      ...(input.districtId !== undefined ? { districtId: input.districtId } : {}),
      ...(input.primaryPlaceId !== undefined ? { primaryPlaceId: input.primaryPlaceId } : {}),
      ...(input.serviceAreaPlaceIds !== undefined
        ? { serviceAreaPlaceIds: [...new Set(input.serviceAreaPlaceIds)] }
        : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.yearsOperating !== undefined ? { yearsOperating: input.yearsOperating } : {}),
      ...(input.vehicleCategoryIds !== undefined
        ? { vehicleCategoryIds: [...new Set(input.vehicleCategoryIds)] }
        : {}),
      ...(input.fleetSizeEstimate !== undefined
        ? { fleetSizeEstimate: input.fleetSizeEstimate }
        : {}),
      ...(input.offersDelivery !== undefined ? { offersDelivery: input.offersDelivery } : {}),
      ...(input.offersAirportTransfer !== undefined
        ? { offersAirportTransfer: input.offersAirportTransfer }
        : {}),
      ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.applicantNotes !== undefined ? { applicantNotes: input.applicantNotes } : {}),
    };

    if (!existing) {
      const [created] = await this.db
        .insert(providerApplications)
        .values({ userId, ...values })
        .returning();
      if (!created) throw new Error('Failed to create provider application');
      this.logger.info({ userId, applicationId: created.id }, 'Provider application drafted');
      return created;
    }

    const [updated] = await this.db
      .update(providerApplications)
      .set(values)
      .where(
        and(
          eq(providerApplications.id, existing.id),
          inArray(providerApplications.status, ['draft', 'changes_requested']),
        ),
      )
      .returning();
    if (!updated) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        'The application can no longer be edited',
        409,
      );
    }
    return updated;
  }

  /** Validates completeness and references, then moves the application to `submitted`. */
  async submit(userId: string, meta: RequestMeta): Promise<ProviderApplication> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiException('UNAUTHENTICATED', 'Authentication required', 401);
    if (!user.emailVerifiedAt) {
      throw new ApiException('EMAIL_NOT_VERIFIED', 'Verify your e-mail before applying', 403);
    }

    const application = await this.getMineOrThrow(userId);
    if (!canApplicant('submit', application.status)) {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `An application that is ${application.status.replace('_', ' ')} cannot be submitted`,
        409,
      );
    }

    const required = ProviderApplicationRequiredSchema.safeParse(applicationFields(application));
    const issues: ApiErrorDetail[] = required.success
      ? []
      : required.error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          issue: issue.message,
        }));
    issues.push(
      ...(await this.reference.validateApplicationReferences({
        districtId: application.districtId,
        primaryPlaceId: application.primaryPlaceId,
        serviceAreaPlaceIds: application.serviceAreaPlaceIds,
        vehicleCategoryIds: application.vehicleCategoryIds,
      })),
    );
    if (issues.length > 0) {
      throw new ApiException('VALIDATION_ERROR', 'The application is incomplete', 400, issues);
    }

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [submitted] = await tx
        .update(providerApplications)
        .set({
          status: 'submitted',
          submittedAt: now,
          agreementAcceptedAt: now,
          agreementVersion: CURRENT_PROVIDER_AGREEMENT_VERSION,
          reviewReason: null,
        })
        .where(
          and(
            eq(providerApplications.id, application.id),
            inArray(providerApplications.status, [...APPLICANT_TRANSITIONS.submit.from]),
          ),
        )
        .returning();
      if (!submitted) {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          'The application was changed concurrently',
          409,
        );
      }

      await this.audit.record(
        {
          actorUserId: userId,
          actorType: 'customer',
          action: 'provider_application.submitted',
          targetType: 'provider_application',
          targetId: submitted.id,
          ip: meta.ip ?? null,
          metadata: { resubmission: application.status === 'changes_requested' },
        },
        tx,
      );

      await this.email.enqueue(
        providerApplicationReceivedEmail({
          to: user.email,
          fullName: user.fullName,
          displayName: submitted.displayName ?? 'your business',
          statusLink: `${this.webAppUrl}/provider/application`,
        }),
        tx,
      );
      if (this.operatorEmail) {
        await this.email.enqueue(
          operatorNewApplicationEmail({
            to: this.operatorEmail,
            displayName: submitted.displayName ?? '(no name)',
            applicantEmail: user.email,
            reviewLink: `${this.webAppUrl}/admin/providers/applications/${submitted.id}`,
          }),
          tx,
        );
      }

      this.logger.info({ userId, applicationId: submitted.id }, 'Provider application submitted');
      return submitted;
    });
  }
}
