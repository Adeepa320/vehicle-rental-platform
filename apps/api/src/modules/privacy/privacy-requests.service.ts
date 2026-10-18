import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PRIVACY_REQUEST_OPEN_STATUSES,
  type AdminCreatePrivacyRequest,
  type AdminPrivacyRequest,
  type AdminPrivacyRequestCompleteAccess,
  type AdminPrivacyRequestCompleteDeletion,
  type AdminPrivacyRequestList,
  type AdminPrivacyRequestListQuery,
  type AdminPrivacyRequestReject,
  type AnonymisationBlocker,
  type CreateDeletionRequest,
  type PrivacyRequest,
  type PrivacyRequestList,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
  type UserDataExport,
} from '@vrp/contracts';
import {
  privacyRequests,
  users,
  type Database,
  type DatabaseExecutor,
  type PrivacyRequestRow,
} from '@vrp/database';
import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AdminUsersService } from '../admin/admin-users.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { EmailService } from '../notifications/email/email.service';
import {
  operatorPrivacyRequestEmail,
  privacyRequestCompletedEmail,
  privacyRequestReceivedEmail,
  privacyRequestRejectedEmail,
} from '../notifications/email/privacy-templates';
import { NotificationsService } from '../notifications/inapp/notifications.service';
import { PrivacyExportService } from './privacy-export.service';
import { toAdminPrivacyRequestView, toPrivacyRequestView } from './privacy.mappers';

const OPEN = [...PRIVACY_REQUEST_OPEN_STATUSES];

/**
 * Data-subject requests (Phase 10, TECH_DECISIONS D69). The record is the
 * source of truth for "who asked, when, what happened"; the operator works it
 * from the console. Completion of a deletion runs the Phase 9 anonymisation —
 * with its blockers and its confirmation — never a second erasure path.
 * Every transition is status-conditioned and audited.
 */
@Injectable()
export class PrivacyRequestsService {
  private readonly operatorEmail: string | undefined;
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService<Env, true>,
    private readonly adminUsers: AdminUsersService,
    private readonly exporter: PrivacyExportService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PrivacyRequestsService.name);
    this.operatorEmail = config.get('OPERATOR_NOTIFICATION_EMAIL', { infer: true });
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ------------------------------------------------------------ requester

  async exportForSelf(user: AuthenticatedUser, meta: RequestMeta): Promise<UserDataExport> {
    const data = await this.exporter.build(user.id);
    await this.audit.record({
      actorUserId: user.id,
      actorType: 'customer',
      action: 'user.data_exported',
      targetType: 'user',
      targetId: user.id,
      ip: meta.ip ?? null,
      metadata: { truncated: data.truncated },
    });
    this.logger.info({ userId: user.id }, 'Personal data export generated');
    return data;
  }

  async createDeletionRequest(
    user: AuthenticatedUser,
    input: CreateDeletionRequest,
    meta: RequestMeta,
  ): Promise<PrivacyRequest> {
    if (input.confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'confirmEmail', issue: 'does not match the account e-mail address' },
      ]);
    }
    const row = await this.create(user.id, 'deletion', 'self', input.note ?? null, {
      actorUserId: user.id,
      actorType: 'customer',
      ip: meta.ip ?? null,
    });
    return toPrivacyRequestView(row, await this.blockersFor(row));
  }

  async listForUser(userId: string): Promise<PrivacyRequestList> {
    const rows = await this.db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.userId, userId))
      .orderBy(desc(privacyRequests.requestedAt), desc(privacyRequests.id))
      .limit(50);
    const data: PrivacyRequest[] = [];
    for (const row of rows) data.push(toPrivacyRequestView(row, await this.blockersFor(row)));
    return { data };
  }

  // ---------------------------------------------------------------- admin

  async adminCreate(
    admin: AuthenticatedUser,
    input: AdminCreatePrivacyRequest,
    meta: RequestMeta,
  ): Promise<AdminPrivacyRequest> {
    const [user] = await this.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw new ApiException('NOT_FOUND', 'User not found', 404);
    const row = await this.create(user.id, input.type, 'admin', input.requesterNote ?? null, {
      actorUserId: admin.id,
      actorType: 'admin',
      ip: meta.ip ?? null,
    });
    return this.adminView(row);
  }

  async adminList(query: AdminPrivacyRequestListQuery): Promise<AdminPrivacyRequestList> {
    const cursor = decodeCursor(query.cursor);
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(privacyRequests.status, query.status));
    if (query.type) conditions.push(eq(privacyRequests.type, query.type));
    if (query.userId) conditions.push(eq(privacyRequests.userId, query.userId));
    if (cursor) {
      conditions.push(
        or(
          lt(privacyRequests.createdAt, cursor.createdAt),
          and(eq(privacyRequests.createdAt, cursor.createdAt), lt(privacyRequests.id, cursor.id)),
        ) as SQL,
      );
    }
    const rows = await this.db
      .select()
      .from(privacyRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(privacyRequests.createdAt), desc(privacyRequests.id))
      .limit(query.limit + 1);
    const page = paginate(rows, query.limit);
    const data: AdminPrivacyRequest[] = [];
    for (const row of page.data) data.push(await this.adminView(row));
    return { data, nextCursor: page.nextCursor };
  }

  async adminGet(id: string): Promise<AdminPrivacyRequest> {
    return this.adminView(await this.getRow(id));
  }

  async startReview(
    admin: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<AdminPrivacyRequest> {
    const now = new Date();
    const row = await this.transition(id, ['open'], {
      status: 'in_review',
      acknowledgedAt: now,
      handledBy: admin.id,
    });
    await this.audit.record({
      actorUserId: admin.id,
      actorType: 'admin',
      action: 'privacy_request.review_started',
      targetType: 'privacy_request',
      targetId: id,
      ip: meta.ip ?? null,
      metadata: { type: row.type, userId: row.userId },
    });
    return this.adminView(row);
  }

  async setInternalNote(
    admin: AuthenticatedUser,
    id: string,
    note: string,
    meta: RequestMeta,
  ): Promise<AdminPrivacyRequest> {
    const existing = await this.getRow(id);
    const [row] = await this.db
      .update(privacyRequests)
      .set({ internalNote: note.length > 0 ? note : null })
      .where(eq(privacyRequests.id, existing.id))
      .returning();
    await this.audit.record({
      actorUserId: admin.id,
      actorType: 'admin',
      action: 'privacy_request.internal_note_updated',
      targetType: 'privacy_request',
      targetId: id,
      ip: meta.ip ?? null,
    });
    return this.adminView(row as PrivacyRequestRow);
  }

  async completeAccess(
    admin: AuthenticatedUser,
    id: string,
    input: AdminPrivacyRequestCompleteAccess,
    meta: RequestMeta,
  ): Promise<AdminPrivacyRequest> {
    const existing = await this.getRow(id);
    if (existing.type !== 'access') {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        'Use complete-deletion for a deletion request',
        409,
      );
    }
    return this.finish(admin, existing, 'completed', input.publicNote, input.internalNote, meta);
  }

  /**
   * Runs the Phase 9 anonymisation (same blockers, same e-mail confirmation),
   * then marks the request completed. If the account was already anonymised
   * (an earlier attempt completed the erasure but not the record), only the
   * record is updated.
   */
  async completeDeletion(
    admin: AuthenticatedUser,
    id: string,
    input: AdminPrivacyRequestCompleteDeletion,
    meta: RequestMeta,
  ): Promise<AdminPrivacyRequest> {
    const existing = await this.getRow(id);
    if (existing.type !== 'deletion') {
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        'Use complete-access for an access request',
        409,
      );
    }
    if (!OPEN.includes(existing.status)) {
      throw new ApiException('INVALID_STATE_TRANSITION', `Request is ${existing.status}`, 409);
    }
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1);
    if (user?.status !== 'deleted') {
      await this.adminUsers.anonymise(
        admin,
        existing.userId,
        { reason: input.reason, confirmEmail: input.confirmEmail },
        meta,
      );
    }
    return this.finish(
      admin,
      existing,
      'completed',
      input.publicNote ?? null,
      input.internalNote,
      meta,
      // The address is gone; the anonymisation already sent its courtesy e-mail.
      { notifyRequester: false },
    );
  }

  async reject(
    admin: AuthenticatedUser,
    id: string,
    input: AdminPrivacyRequestReject,
    meta: RequestMeta,
  ): Promise<AdminPrivacyRequest> {
    const existing = await this.getRow(id);
    return this.finish(admin, existing, 'rejected', input.publicNote, input.internalNote, meta);
  }

  async exportForAdmin(
    admin: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<UserDataExport> {
    const row = await this.getRow(id);
    const data = await this.exporter.build(row.userId);
    await this.audit.record({
      actorUserId: admin.id,
      actorType: 'admin',
      action: 'privacy_request.export_generated',
      targetType: 'privacy_request',
      targetId: id,
      ip: meta.ip ?? null,
      metadata: { userId: row.userId, truncated: data.truncated },
    });
    return data;
  }

  // -------------------------------------------------------------- internals

  private async create(
    userId: string,
    type: PrivacyRequestType,
    source: 'self' | 'admin',
    requesterNote: string | null,
    actor: { actorUserId: string; actorType: 'customer' | 'admin'; ip: string | null },
  ): Promise<PrivacyRequestRow> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user) throw new ApiException('NOT_FOUND', 'User not found', 404);
      if (user.status === 'deleted') {
        throw new ApiException('CONFLICT', 'This account has already been anonymised', 409);
      }
      const [open] = await tx
        .select({ id: privacyRequests.id })
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.userId, userId),
            eq(privacyRequests.type, type),
            inArray(privacyRequests.status, OPEN),
          ),
        )
        .limit(1);
      if (open) {
        throw new ApiException(
          'PRIVACY_REQUEST_ALREADY_OPEN',
          `A ${type} request is already being processed`,
          409,
        );
      }
      const [row] = await tx
        .insert(privacyRequests)
        .values({ userId, type, source, requesterNote })
        .returning();
      if (!row) throw new Error('Failed to create privacy request');
      await this.audit.record(
        {
          actorUserId: actor.actorUserId,
          actorType: actor.actorType,
          action: 'privacy_request.created',
          targetType: 'privacy_request',
          targetId: row.id,
          ip: actor.ip,
          metadata: { type, source, userId },
        },
        tx,
      );
      await this.notifications.create(tx, {
        userId,
        type: 'privacy.request_received',
        title:
          type === 'deletion'
            ? 'We received your account deletion request'
            : 'We received your data access request',
        body: 'Our team will respond to the e-mail address on your account. You can follow the status under Privacy.',
        linkPath: '/account/privacy',
        dedupeKey: `privacy:${row.id}:received`,
      });
      await this.email.enqueue(
        privacyRequestReceivedEmail({ to: user.email, fullName: user.fullName, type }),
        tx,
      );
      if (this.operatorEmail) {
        await this.email.enqueue(
          operatorPrivacyRequestEmail({
            to: this.operatorEmail,
            type,
            requestId: row.id,
            requestedAt: row.requestedAt,
            webAppUrl: this.webAppUrl,
          }),
          tx,
        );
      }
      this.logger.info({ requestId: row.id, type, source }, 'Privacy request created');
      return row;
    });
  }

  private async finish(
    admin: AuthenticatedUser,
    existing: PrivacyRequestRow,
    status: Extract<PrivacyRequestStatus, 'completed' | 'rejected'>,
    publicNote: string | null,
    internalNote: string | undefined,
    meta: RequestMeta,
    options: { notifyRequester: boolean } = { notifyRequester: true },
  ): Promise<AdminPrivacyRequest> {
    const now = new Date();
    const row = await this.db.transaction(async (tx) => {
      const updated = await this.transition(
        existing.id,
        OPEN,
        {
          status,
          handledBy: admin.id,
          acknowledgedAt: existing.acknowledgedAt ?? now,
          publicNote,
          ...(internalNote !== undefined ? { internalNote: internalNote || null } : {}),
          ...(status === 'completed' ? { completedAt: now } : { rejectedAt: now }),
        },
        tx,
      );
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: status === 'completed' ? 'privacy_request.completed' : 'privacy_request.rejected',
          targetType: 'privacy_request',
          targetId: existing.id,
          reason: publicNote,
          ip: meta.ip ?? null,
          metadata: { type: existing.type, userId: existing.userId },
        },
        tx,
      );
      if (options.notifyRequester) {
        const [user] = await tx.select().from(users).where(eq(users.id, existing.userId)).limit(1);
        if (user && user.status !== 'deleted') {
          await this.notifications.create(tx, {
            userId: user.id,
            type: status === 'completed' ? 'privacy.request_completed' : 'privacy.request_rejected',
            title:
              status === 'completed'
                ? `Your ${existing.type} request has been completed`
                : `About your ${existing.type} request`,
            body: publicNote ?? 'See your e-mail for details.',
            linkPath: '/account/privacy',
            dedupeKey: `privacy:${existing.id}:${status}`,
          });
          await this.email.enqueue(
            status === 'completed'
              ? privacyRequestCompletedEmail({
                  to: user.email,
                  fullName: user.fullName,
                  type: existing.type,
                  publicNote,
                })
              : privacyRequestRejectedEmail({
                  to: user.email,
                  fullName: user.fullName,
                  type: existing.type,
                  publicNote: publicNote ?? '',
                }),
            tx,
          );
        }
      }
      return updated;
    });
    this.logger.info({ requestId: existing.id, status }, 'Privacy request closed');
    return this.adminView(row);
  }

  private async transition(
    id: string,
    from: PrivacyRequestStatus[],
    set: Partial<typeof privacyRequests.$inferInsert>,
    executor: DatabaseExecutor = this.db,
  ): Promise<PrivacyRequestRow> {
    const [row] = await executor
      .update(privacyRequests)
      .set(set)
      .where(and(eq(privacyRequests.id, id), inArray(privacyRequests.status, from)))
      .returning();
    if (!row) {
      const current = await this.getRow(id, executor);
      throw new ApiException(
        'INVALID_STATE_TRANSITION',
        `Request is ${current.status}; expected ${from.join(' or ')}`,
        409,
      );
    }
    return row;
  }

  private async getRow(
    id: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<PrivacyRequestRow> {
    const [row] = await executor
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Privacy request not found', 404);
    return row;
  }

  /** Current anonymisation blockers for an open deletion request; otherwise none. */
  private async blockersFor(row: PrivacyRequestRow): Promise<AnonymisationBlocker[]> {
    if (row.type !== 'deletion' || !OPEN.includes(row.status)) return [];
    try {
      return (await this.adminUsers.get(row.userId)).anonymisation.blockers;
    } catch {
      return [];
    }
  }

  private async adminView(row: PrivacyRequestRow): Promise<AdminPrivacyRequest> {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
        roles: users.roles,
      })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user) throw new ApiException('NOT_FOUND', 'User not found', 404);
    let handledBy: { id: string; email: string } | null = null;
    if (row.handledBy) {
      const [handler] = await this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, row.handledBy))
        .limit(1);
      handledBy = handler ?? null;
    }
    return toAdminPrivacyRequestView(row, {
      user,
      handledBy,
      blockers: await this.blockersFor(row),
    });
  }
}
