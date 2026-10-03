import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { oneTimeTokens, type DatabaseExecutor, type OneTimeTokenPurpose } from '@vrp/database';
import { and, count, eq, gt, isNull } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';

const RATE_WINDOW_MS = 15 * 60 * 1000;

export type IssueResult = { raw: string; expiresAt: Date } | { capped: true };

/**
 * Single-use e-mail tokens (verification, password reset). Raw tokens are
 * 256-bit random, delivered only inside the e-mail, and stored as SHA-256
 * hashes. Issuing a new token for a purpose consumes the previous ones.
 */
@Injectable()
export class OneTimeTokenService {
  private readonly perUserCap: number;
  private readonly ttlMs: Record<OneTimeTokenPurpose, number>;

  constructor(config: ConfigService<Env, true>) {
    this.perUserCap = config.get('AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN', { infer: true });
    this.ttlMs = {
      verify_email: config.get('EMAIL_VERIFICATION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000,
      password_reset: config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true }) * 60 * 1000,
    };
  }

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  ttlFor(purpose: OneTimeTokenPurpose): number {
    return this.ttlMs[purpose];
  }

  /**
   * Creates a token inside the caller's transaction. Returns `{ capped: true }`
   * (and creates nothing) when the user already requested the per-window
   * maximum, so callers can silently skip the e-mail.
   */
  async issue(
    executor: DatabaseExecutor,
    userId: string,
    purpose: OneTimeTokenPurpose,
    meta: { ip?: string } = {},
  ): Promise<IssueResult> {
    const windowStart = new Date(Date.now() - RATE_WINDOW_MS);
    const [recent] = await executor
      .select({ value: count() })
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          gt(oneTimeTokens.createdAt, windowStart),
        ),
      );
    if ((recent?.value ?? 0) >= this.perUserCap) {
      return { capped: true };
    }

    // Only one live token per purpose: supersede earlier unconsumed ones.
    await executor
      .update(oneTimeTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.consumedAt),
        ),
      );

    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs[purpose]);
    await executor.insert(oneTimeTokens).values({
      userId,
      purpose,
      tokenHash: OneTimeTokenService.hash(raw),
      expiresAt,
      requestIp: meta.ip ?? null,
    });
    return { raw, expiresAt };
  }

  /**
   * Atomically consumes a token (`consumed_at IS NULL` → set). Throws
   * `TOKEN_INVALID` for unknown, wrong-purpose or already-used tokens and
   * `TOKEN_EXPIRED` for expired ones (which are consumed as well).
   */
  async consume(
    executor: DatabaseExecutor,
    raw: string,
    purpose: OneTimeTokenPurpose,
  ): Promise<{ userId: string }> {
    const [claimed] = await executor
      .update(oneTimeTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oneTimeTokens.tokenHash, OneTimeTokenService.hash(raw)),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.consumedAt),
        ),
      )
      .returning({ userId: oneTimeTokens.userId, expiresAt: oneTimeTokens.expiresAt });

    if (!claimed) {
      throw new ApiException('TOKEN_INVALID', 'This link is invalid or has already been used', 400);
    }
    if (claimed.expiresAt.getTime() <= Date.now()) {
      throw new ApiException(
        'TOKEN_EXPIRED',
        'This link has expired; please request a new one',
        400,
      );
    }
    return { userId: claimed.userId };
  }
}
