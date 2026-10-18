import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthClient } from '@vrp/contracts';
import {
  refreshTokens,
  users,
  type DatabaseExecutor,
  type Database,
  type RefreshToken,
} from '@vrp/database';
import { and, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import type { RequestMeta } from './auth.types';

export interface IssuedRefreshToken {
  /** Raw token for the client. Never stored or logged. */
  raw: string;
  record: RefreshToken;
}

export interface IssueRefreshTokenInput extends RequestMeta {
  userId: string;
  roles: readonly string[];
  client: AuthClient;
  /** Reuse an existing family on rotation; a new family is created otherwise. */
  familyId?: string;
  /** Lifetime override; rotation passes the rotated token's own lifetime so admins keep the short class. */
  ttlMs?: number;
  /** When the family completed the second factor (Phase 10); carried over on rotation. */
  mfaVerifiedAt?: Date | null;
}

const ADMIN_REFRESH_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Opaque refresh tokens with rotation and reuse detection
 * (SECURITY_AND_PRIVACY.md §2.2). Only SHA-256 hashes are persisted.
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlMs: number;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RefreshTokenService.name);
    this.ttlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async issue(
    executor: DatabaseExecutor,
    input: IssueRefreshTokenInput,
  ): Promise<IssuedRefreshToken> {
    const raw = randomBytes(32).toString('base64url');
    const ttl =
      input.ttlMs ??
      (input.roles.includes('admin') || input.roles.includes('super_admin')
        ? ADMIN_REFRESH_TTL_MS
        : this.ttlMs);
    const [record] = await executor
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        tokenHash: RefreshTokenService.hash(raw),
        familyId: input.familyId ?? randomUUID(),
        client: input.client,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
        mfaVerifiedAt: input.mfaVerifiedAt ?? null,
        expiresAt: new Date(Date.now() + ttl),
      })
      .returning();
    if (!record) throw new Error('Failed to persist refresh token');
    return { raw, record };
  }

  /**
   * Validates and rotates a refresh token. The old row is claimed atomically
   * (`revoked_at IS NULL` → set) so two concurrent uses cannot both succeed;
   * presenting an already-rotated or revoked token revokes its whole family.
   */
  async rotate(
    raw: string,
    meta: RequestMeta,
  ): Promise<{ previous: RefreshToken; issued: IssuedRefreshToken }> {
    const hash = RefreshTokenService.hash(raw);
    const [existing] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);

    if (!existing) {
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    if (existing.revokedAt) {
      await this.revokeFamily({ userId: existing.userId, familyId: existing.familyId });
      this.logger.warn(
        { userId: existing.userId, familyId: existing.familyId },
        'Refresh token reuse detected; family revoked',
      );
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.revokeById(existing.id);
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }

    const outcome = await this.db.transaction(async (tx) => {
      // Same lock as every revocation (`withUserLock`): a logout / logout-all that
      // commits first makes the claim below fail; one that waits on us sees the
      // new token, because its UPDATE only starts after this transaction commits.
      await this.lockUser(tx, existing.userId);
      const now = new Date();
      const claimed = await tx
        .update(refreshTokens)
        .set({ revokedAt: now, lastUsedAt: now })
        .where(and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (claimed.length === 0) return null;
      const issued = await this.issue(tx, {
        userId: existing.userId,
        roles: [],
        // The rotated token inherits the lifetime it was issued with, so an admin's
        // 8-hour class survives rotation instead of widening to the default TTL.
        ttlMs: Math.max(60_000, existing.expiresAt.getTime() - existing.createdAt.getTime()),
        mfaVerifiedAt: existing.mfaVerifiedAt,
        client: existing.client as AuthClient,
        familyId: existing.familyId,
        ...meta,
      });
      await tx
        .update(refreshTokens)
        .set({ replacedById: issued.record.id })
        .where(eq(refreshTokens.id, existing.id));
      return { previous: existing, issued };
    });
    if (!outcome) {
      // Lost a race with a concurrent refresh, or the session was revoked meanwhile:
      // treat as reuse. Revoked outside the transaction above so it is not rolled back.
      await this.revokeFamily({ userId: existing.userId, familyId: existing.familyId });
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    return outcome;
  }

  /** Marks the live token of a session family as MFA-verified (enrolment confirmed in that session). */
  async markFamilyMfaVerified(
    familyId: string,
    at: Date,
    executor: DatabaseExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ mfaVerifiedAt: at })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /** Drops the verified mark from every session of a user (factor disabled or reset). */
  async clearMfaForUser(userId: string, executor: DatabaseExecutor = this.db): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ mfaVerifiedAt: null })
      .where(eq(refreshTokens.userId, userId));
  }

  /**
   * Logout of one session by its raw refresh token: the token's whole family
   * (the logical session `sid`) is revoked, so every access token bound to it
   * stops working at once. Unknown tokens are ignored.
   */
  async revokeFamilyOfRaw(raw: string): Promise<void> {
    const [row] = await this.db
      .select({ userId: refreshTokens.userId, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, RefreshTokenService.hash(raw)))
      .limit(1);
    if (row) await this.revokeFamily(row);
  }

  async revokeById(id: string, executor: DatabaseExecutor = this.db): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
  }

  /** Revokes one logical session (refresh family) of a user. */
  async revokeFamily(
    session: { userId: string; familyId: string },
    executor: DatabaseExecutor = this.db,
  ): Promise<void> {
    await this.withUserLock(executor, session.userId, (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.familyId, session.familyId),
            eq(refreshTokens.userId, session.userId),
            isNull(refreshTokens.revokedAt),
          ),
        ),
    );
  }

  async revokeAllForUser(userId: string, executor: DatabaseExecutor = this.db): Promise<void> {
    await this.withUserLock(executor, userId, (tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))),
    );
  }

  /**
   * Revocations and rotation serialise on the user row (`FOR NO KEY UPDATE`, the
   * lock an `UPDATE users` takes anyway, so admin suspension / anonymisation and
   * password changes already hold it). Without it a logout could miss the token a
   * concurrent rotation inserts and leave a revoked session alive.
   */
  private async withUserLock(
    executor: DatabaseExecutor,
    userId: string,
    fn: (tx: DatabaseExecutor) => Promise<unknown>,
  ): Promise<void> {
    if (executor === this.db) {
      await this.db.transaction(async (tx) => {
        await this.lockUser(tx, userId);
        await fn(tx);
      });
      return;
    }
    await this.lockUser(executor, userId);
    await fn(executor);
  }

  private async lockUser(executor: DatabaseExecutor, userId: string): Promise<void> {
    await executor
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('no key update');
  }

  /** Active (unrevoked, unexpired) sessions of a user. */
  async countActive(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: refreshTokens.id, expiresAt: refreshTokens.expiresAt })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    const now = Date.now();
    return rows.filter((row) => row.expiresAt.getTime() > now).length;
  }
}
