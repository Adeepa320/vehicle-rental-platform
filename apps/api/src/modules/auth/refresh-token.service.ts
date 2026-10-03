import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthClient } from '@vrp/contracts';
import {
  refreshTokens,
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
      input.roles.includes('admin') || input.roles.includes('super_admin')
        ? ADMIN_REFRESH_TTL_MS
        : this.ttlMs;
    const [record] = await executor
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        tokenHash: RefreshTokenService.hash(raw),
        familyId: input.familyId ?? randomUUID(),
        client: input.client,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
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
      await this.revokeFamily(existing.familyId);
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

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx
        .update(refreshTokens)
        .set({ revokedAt: now, lastUsedAt: now })
        .where(and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (claimed.length === 0) {
        // Lost a race with a concurrent refresh of the same token: treat as reuse.
        await this.revokeFamily(existing.familyId, tx);
        throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
      }
      const issued = await this.issue(tx, {
        userId: existing.userId,
        roles: [], // TTL is decided by the caller-provided roles on login; rotation keeps the user's class
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
  }

  /** Revokes one token by its raw value (logout). Unknown tokens are ignored. */
  async revokeRaw(raw: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, RefreshTokenService.hash(raw)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  async revokeById(id: string, executor: DatabaseExecutor = this.db): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
  }

  async revokeFamily(familyId: string, executor: DatabaseExecutor = this.db): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string, executor: DatabaseExecutor = this.db): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
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
