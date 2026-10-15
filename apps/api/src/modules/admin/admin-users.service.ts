import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ANONYMISED_FULL_NAME,
  OPEN_BOOKING_STATUSES,
  anonymisedEmailFor,
  type AdminUserDetail,
  type AdminUserList,
  type AdminUserListQuery,
  type AdminUserSummary,
  type AnonymisationBlocker,
  type AnonymiseUserRequest,
  type ReactivateUserRequest,
  type SuspendUserRequest,
} from '@vrp/contracts';
import {
  bookingDrivers,
  bookings,
  disputes,
  oneTimeTokens,
  payments,
  providerApplications,
  providerProfiles,
  reviews,
  users,
  type Database,
  type DatabaseExecutor,
  type ProviderProfile,
  type User,
} from '@vrp/database';
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../common/pagination';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  accountAnonymisedEmail,
  accountReactivatedEmail,
  accountSuspendedEmail,
} from '../notifications/email/admin-templates';
import { EmailService } from '../notifications/email/email.service';
import { NotificationsService } from '../notifications/inapp/notifications.service';

const OPEN = [...OPEN_BOOKING_STATUSES] as (typeof bookings.$inferSelect)['status'][];

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Admin user management (Phase 9, PRD FR-AD2; TECH_DECISIONS D65). Suspension
 * uses the existing `users.status` that the auth guard already honours and
 * revokes every session; anonymisation keeps the row and every booking,
 * payment, review and audit reference, replaces the personal data with
 * neutral values and is refused while any operational dependency is open.
 * Every action is audited with the actor, the target and the reason.
 */
@Injectable()
export class AdminUsersService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly refreshTokens: RefreshTokenService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminUsersService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async list(query: AdminUserListQuery): Promise<AdminUserList> {
    const cursor = decodeCursor(query.cursor);
    const q = query.q ? `%${escapeLike(query.q)}%` : undefined;
    const rows = await this.db
      .select({ user: users, providerId: providerProfiles.id })
      .from(users)
      .leftJoin(providerProfiles, eq(providerProfiles.userId, users.id))
      .where(
        and(
          q ? or(ilike(users.email, q), ilike(users.fullName, q)) : undefined,
          query.status ? eq(users.status, query.status) : undefined,
          query.role ? sql`${query.role} = any(${users.roles})` : undefined,
          query.createdFrom
            ? gte(users.createdAt, new Date(`${query.createdFrom}T00:00:00+05:30`))
            : undefined,
          query.createdTo
            ? lte(users.createdAt, new Date(`${query.createdTo}T23:59:59.999+05:30`))
            : undefined,
          cursor
            ? or(
                lt(users.createdAt, cursor.createdAt),
                and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit + 1);
    const page = paginate(
      rows.map((r) => ({ ...r, createdAt: r.user.createdAt, id: r.user.id })),
      query.limit,
    );
    return {
      data: page.data.map((r) => this.summary(r.user, r.providerId)),
      nextCursor: page.nextCursor,
    };
  }

  async get(id: string): Promise<AdminUserDetail> {
    const [row] = await this.db
      .select({ user: users, provider: providerProfiles })
      .from(users)
      .leftJoin(providerProfiles, eq(providerProfiles.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'User not found', 404);
    const provider = row.provider;
    const [asCustomer, asProvider, reviewCount, openDisputes, blockers] = await Promise.all([
      this.bookingCounts(eq(bookings.customerUserId, id)),
      provider
        ? this.bookingCounts(eq(bookings.providerId, provider.id))
        : Promise.resolve({ total: 0, open: 0, completed: 0 }),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(reviews)
        .where(eq(reviews.customerUserId, id))
        .then((r) => r[0]?.count ?? 0),
      this.openDisputeCount(id, provider?.id ?? null),
      this.blockersFor(row.user, provider),
    ]);
    return {
      ...this.summary(row.user, provider?.id ?? null),
      phone: row.user.phoneE164,
      phoneVerified: row.user.phoneVerifiedAt !== null,
      preferredLanguage: row.user.preferredLanguage,
      suspendedAt: row.user.suspendedAt ? row.user.suspendedAt.toISOString() : null,
      suspensionReason: row.user.suspensionReason,
      deletedAt: row.user.deletedAt ? row.user.deletedAt.toISOString() : null,
      provider: provider
        ? { id: provider.id, displayName: provider.displayName, status: provider.status }
        : null,
      bookings: { asCustomer, asProvider },
      reviews: reviewCount,
      openDisputes,
      anonymisation: { allowed: blockers.length === 0, blockers },
    };
  }

  async suspend(
    admin: AuthenticatedUser,
    id: string,
    input: SuspendUserRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminUserDetail> {
    if (id === admin.id) {
      throw new ApiException('CONFLICT', 'You cannot suspend your own account', 409);
    }
    await this.db.transaction(async (tx) => {
      const user = await this.lock(tx, id);
      this.assertPrivilegeBoundary(admin, user);
      if (user.status !== 'active') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `The account is already ${user.status}`,
          409,
        );
      }
      const [updated] = await tx
        .update(users)
        .set({
          status: 'suspended',
          suspendedAt: now,
          suspendedBy: admin.id,
          suspensionReason: input.reason,
          sessionsRevokedAt: now,
        })
        .where(and(eq(users.id, id), eq(users.status, 'active')))
        .returning({ id: users.id });
      if (!updated)
        throw new ApiException('INVALID_STATE_TRANSITION', 'The account changed concurrently', 409);
      await this.refreshTokens.revokeAllForUser(id, tx);
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'user.suspended',
          targetType: 'user',
          targetId: id,
          reason: input.reason,
          ip: meta.ip ?? null,
          metadata: { sessionsRevoked: true },
        },
        tx,
      );
      await this.notifications.create(tx, {
        userId: id,
        type: 'account.suspended',
        title: 'Your account has been suspended',
        body: `Reason: ${input.reason}. Existing bookings are not cancelled by this.`,
        linkPath: '/account',
        dedupeKey: `user:${id}:suspended:${now.getTime()}`,
      });
      await this.email.enqueue(
        accountSuspendedEmail({ to: user.email, fullName: user.fullName, reason: input.reason }),
        tx,
      );
      this.logger.info({ userId: id, adminId: admin.id }, 'User suspended');
    });
    return this.get(id);
  }

  async reactivate(
    admin: AuthenticatedUser,
    id: string,
    input: ReactivateUserRequest,
    meta: RequestMeta,
  ): Promise<AdminUserDetail> {
    await this.db.transaction(async (tx) => {
      const user = await this.lock(tx, id);
      this.assertPrivilegeBoundary(admin, user);
      if (user.status !== 'suspended') {
        throw new ApiException(
          'INVALID_STATE_TRANSITION',
          `The account is ${user.status}, not suspended`,
          409,
        );
      }
      await tx
        .update(users)
        .set({ status: 'active', suspendedAt: null, suspendedBy: null, suspensionReason: null })
        .where(and(eq(users.id, id), eq(users.status, 'suspended')));
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'user.reactivated',
          targetType: 'user',
          targetId: id,
          reason: input.note ?? null,
          ip: meta.ip ?? null,
        },
        tx,
      );
      await this.notifications.create(tx, {
        userId: id,
        type: 'account.reactivated',
        title: 'Your account is active again',
        body: 'The suspension has been lifted; you can use the platform as before.',
        linkPath: '/account',
        dedupeKey: `user:${id}:reactivated:${Date.now()}`,
      });
      await this.email.enqueue(
        accountReactivatedEmail({
          to: user.email,
          fullName: user.fullName,
          link: `${this.webAppUrl}/login`,
        }),
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Irreversible. Refused with structured blockers while anything operational
   * depends on the person; otherwise revokes sessions, replaces the personal
   * data with neutral values, scrubs the application and driver snapshots
   * and suspends an owned provider profile so no listing stays bookable
   * under a closed account. Bookings, payments, reviews and audit rows keep
   * their foreign keys.
   */
  async anonymise(
    admin: AuthenticatedUser,
    id: string,
    input: AnonymiseUserRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminUserDetail> {
    if (id === admin.id) {
      throw new ApiException('CONFLICT', 'You cannot anonymise your own account', 409);
    }
    await this.db.transaction(async (tx) => {
      const user = await this.lock(tx, id);
      if (user.email.toLowerCase() !== input.confirmEmail.toLowerCase()) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          { field: 'confirmEmail', issue: 'does not match the account e-mail address' },
        ]);
      }
      const [provider] = await tx
        .select()
        .from(providerProfiles)
        .where(eq(providerProfiles.userId, id))
        .for('update');
      const blockers = await this.blockersFor(user, provider ?? null, tx);
      if (blockers.length > 0) {
        throw new ApiException(
          'ACCOUNT_ANONYMISATION_BLOCKED',
          'The account cannot be anonymised while operational dependencies are open',
          409,
          blockers.map((blocker) => ({ field: 'blockers', issue: blocker })),
        );
      }
      // Courtesy notice to the still-valid address; it is the last message this address gets.
      await this.email.enqueue(
        accountAnonymisedEmail({ to: user.email, fullName: user.fullName }),
        tx,
      );

      await tx
        .update(users)
        .set({
          email: anonymisedEmailFor(id),
          fullName: ANONYMISED_FULL_NAME,
          phoneE164: null,
          phoneVerifiedAt: null,
          countryCode: null,
          // Not a valid Argon2 string: no password can ever verify against it.
          passwordHash: '!anonymised',
          status: 'deleted',
          deletedAt: now,
          sessionsRevokedAt: now,
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
        })
        .where(eq(users.id, id));
      await this.refreshTokens.revokeAllForUser(id, tx);
      await tx.delete(oneTimeTokens).where(eq(oneTimeTokens.userId, id));
      await tx
        .update(providerApplications)
        .set({
          contactName: 'Former applicant',
          phoneE164: null,
          whatsappE164: null,
          addressText: null,
          applicantNotes: null,
          websiteUrl: null,
        })
        .where(eq(providerApplications.userId, id));
      await tx
        .update(bookingDrivers)
        .set({ fullName: 'Former customer' })
        .where(
          inArray(
            bookingDrivers.bookingId,
            tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.customerUserId, id)),
          ),
        );
      let providerSuspended = false;
      if (provider) {
        await tx
          .update(providerProfiles)
          .set({
            contactName: 'Former provider',
            phoneE164: '+00000000000',
            whatsappE164: null,
            description: null,
            websiteUrl: null,
            addressText: 'Removed',
            ...(provider.status === 'active'
              ? {
                  status: 'suspended' as const,
                  suspendedAt: now,
                  suspendedBy: admin.id,
                  suspensionReason: 'Owner account anonymised',
                }
              : {}),
          })
          .where(eq(providerProfiles.id, provider.id));
        providerSuspended = provider.status === 'active';
        if (providerSuspended) {
          await this.audit.record(
            {
              actorUserId: admin.id,
              actorType: 'admin',
              action: 'provider_profile.suspended',
              targetType: 'provider_profile',
              targetId: provider.id,
              reason: 'Owner account anonymised',
              ip: meta.ip ?? null,
            },
            tx,
          );
        }
      }
      await this.audit.record(
        {
          actorUserId: admin.id,
          actorType: 'admin',
          action: 'user.anonymised',
          targetType: 'user',
          targetId: id,
          reason: input.reason,
          ip: meta.ip ?? null,
          metadata: { providerSuspended, sessionsRevoked: true },
        },
        tx,
      );
      this.logger.info({ userId: id, adminId: admin.id }, 'User anonymised');
    });
    return this.get(id);
  }

  // ------------------------------------------------------------- helpers

  private summary(user: User, providerId: string | null): AdminUserSummary {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      countryCode: user.countryCode,
      providerId,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    };
  }

  private async lock(tx: DatabaseExecutor, id: string): Promise<User> {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!user) throw new ApiException('NOT_FOUND', 'User not found', 404);
    return user;
  }

  /** Only a super admin may act on another privileged account. */
  private assertPrivilegeBoundary(admin: AuthenticatedUser, target: User): void {
    const privileged = target.roles.includes('admin') || target.roles.includes('super_admin');
    if (privileged && !admin.roles.includes('super_admin')) {
      throw new ApiException('FORBIDDEN', 'Only a super admin can act on an admin account', 403);
    }
  }

  private async bookingCounts(where: ReturnType<typeof eq>) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${inArray(bookings.status, OPEN)})::int`,
        completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')::int`,
      })
      .from(bookings)
      .where(where);
    return { total: row?.total ?? 0, open: row?.open ?? 0, completed: row?.completed ?? 0 };
  }

  private async openDisputeCount(
    userId: string,
    providerId: string | null,
    executor: DatabaseExecutor = this.db,
  ): Promise<number> {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(disputes)
      .innerJoin(bookings, eq(bookings.id, disputes.bookingId))
      .where(
        and(
          inArray(disputes.status, ['open', 'in_review']),
          providerId
            ? or(eq(bookings.customerUserId, userId), eq(bookings.providerId, providerId))
            : eq(bookings.customerUserId, userId),
        ),
      );
    return row?.count ?? 0;
  }

  private async blockersFor(
    user: User,
    provider: ProviderProfile | null,
    executor: DatabaseExecutor = this.db,
  ): Promise<AnonymisationBlocker[]> {
    const blockers: AnonymisationBlocker[] = [];
    if (user.status === 'deleted') return ['already_anonymised'];
    if (user.roles.includes('admin') || user.roles.includes('super_admin')) {
      blockers.push('privileged_account');
    }
    const scope = provider
      ? or(eq(bookings.customerUserId, user.id), eq(bookings.providerId, provider.id))
      : eq(bookings.customerUserId, user.id);
    const [counts] = await executor
      .select({
        openAsCustomer: sql<number>`count(*) filter (where ${bookings.customerUserId} = ${user.id} and ${inArray(bookings.status, OPEN)})::int`,
        openAsProvider: provider
          ? sql<number>`count(*) filter (where ${bookings.providerId} = ${provider.id} and ${inArray(bookings.status, OPEN)})::int`
          : sql<number>`0`,
      })
      .from(bookings)
      .where(scope);
    if ((counts?.openAsCustomer ?? 0) > 0) blockers.push('open_booking_as_customer');
    if ((counts?.openAsProvider ?? 0) > 0) blockers.push('open_booking_as_provider');
    if ((await this.openDisputeCount(user.id, provider?.id ?? null, executor)) > 0) {
      blockers.push('open_dispute');
    }
    const [money] = await executor
      .select({
        unresolved: sql<number>`count(*) filter (where ${payments.requiresManualResolution} = true and ${payments.anomaly} <> 'refund_due')::int`,
        refundDue: sql<number>`count(*) filter (where ${payments.status} = 'paid' and ${payments.refundDueAmount} > 0)::int`,
      })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(scope);
    if ((money?.unresolved ?? 0) > 0) blockers.push('unresolved_payment');
    if ((money?.refundDue ?? 0) > 0) blockers.push('refund_due');
    return blockers;
  }
}

/** Exposed for tests: the neutral marker written over anonymised password hashes. */
export const ANONYMISED_PASSWORD_HASH = '!anonymised';
