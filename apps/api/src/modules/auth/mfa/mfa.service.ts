import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MFA_LOCK_MINUTES,
  MFA_MAX_FAILED_ATTEMPTS,
  MFA_RECOVERY_CODE_COUNT,
  type MfaEnrolConfirmRequest,
  type MfaEnrolConfirmResponse,
  type MfaEnrolStartRequest,
  type MfaEnrolStartResponse,
  type MfaRecoveryCodes,
  type MfaStatus,
  type MfaStepUpRequest,
  type UserRole,
} from '@vrp/contracts';
import {
  userMfa,
  userMfaRecoveryCodes,
  type Database,
  type DatabaseExecutor,
  type UserMfa,
} from '@vrp/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { DataEncryptionService } from '../../../common/crypto/data-encryption.module';
import { ApiException } from '../../../common/errors/api.exception';
import { derived, type Env } from '../../../config/env.schema';
import { DATABASE } from '../../../database/database.module';
import { AuditService } from '../../audit/audit.service';
import { EmailService } from '../../notifications/email/email.service';
import {
  mfaDisabledEmail,
  mfaEnabledEmail,
  mfaRecoveryCodeUsedEmail,
} from '../../notifications/email/mfa-templates';
import { UsersService } from '../../users/users.service';
import type { AuthenticatedUser, RequestMeta } from '../auth.types';
import { PasswordService } from '../password.service';
import { RefreshTokenService } from '../refresh-token.service';
import { TokenService } from '../token.service';
import {
  generateRecoveryCode,
  generateTotpSecret,
  normaliseRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './totp';

export const PRIVILEGED_ROLES: readonly UserRole[] = ['admin', 'super_admin'];

export function isPrivileged(roles: readonly string[]): boolean {
  return roles.some((role) => (PRIVILEGED_ROLES as readonly string[]).includes(role));
}

/** SHA-256 of the canonical recovery code; the codes are 50-bit random values, never user-chosen. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

const aad = (userId: string): string => `user_mfa:${userId}`;

type CodeCheck = { step: number } | { error: ApiException };

/**
 * Authenticator-app second factor for privileged accounts (Phase 10,
 * TECH_DECISIONS D67). The TOTP secret is stored only as an AES-256-GCM
 * envelope bound to the user id; it is returned exactly once, when enrolment
 * starts. Every verification runs on the row locked `FOR UPDATE`: a code for a
 * step that was already accepted is refused (replay), wrong codes are counted
 * and the factor locks for `MFA_LOCK_MINUTES` after `MFA_MAX_FAILED_ATTEMPTS`.
 * Failure counters are committed before the error is thrown, so a rolled-back
 * transaction can never erase them.
 */
@Injectable()
export class MfaService {
  private readonly issuer: string;
  private readonly policyRequired: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService<Env, true>,
    private readonly encryption: DataEncryptionService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MfaService.name);
    this.issuer = config.get('MFA_ISSUER', { infer: true });
    this.policyRequired = derived.adminMfaRequired({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      ADMIN_MFA_REQUIRED: config.get('ADMIN_MFA_REQUIRED', { infer: true }),
    } as Env);
  }

  /** Whether privileged routes demand a verified factor (production: always). */
  get required(): boolean {
    return this.policyRequired;
  }

  requiredFor(roles: readonly string[]): boolean {
    return this.policyRequired && isPrivileged(roles);
  }

  async isEnrolled(userId: string, executor: DatabaseExecutor = this.db): Promise<boolean> {
    const [row] = await executor
      .select({ confirmedAt: userMfa.confirmedAt })
      .from(userMfa)
      .where(eq(userMfa.userId, userId))
      .limit(1);
    return Boolean(row?.confirmedAt);
  }

  async status(user: AuthenticatedUser): Promise<MfaStatus> {
    const [row] = await this.db.select().from(userMfa).where(eq(userMfa.userId, user.id)).limit(1);
    const enrolled = Boolean(row?.confirmedAt);
    return {
      enrolled,
      pendingEnrolment: Boolean(row) && !enrolled,
      confirmedAt: row?.confirmedAt?.toISOString() ?? null,
      recoveryCodesRemaining: enrolled ? await this.countRemainingCodes(user.id) : 0,
      required: this.requiredFor(user.roles),
      sessionVerified: user.mfaVerified,
    };
  }

  // ------------------------------------------------------------- enrolment

  /** Step 1: a fresh secret, shown once. Requires the password; replaces an unconfirmed enrolment. */
  async startEnrolment(
    user: AuthenticatedUser,
    input: MfaEnrolStartRequest,
    meta: RequestMeta,
  ): Promise<MfaEnrolStartResponse> {
    this.assertPrivileged(user);
    await this.assertPassword(user.id, input.password);
    const secret = generateTotpSecret();
    const ciphertext = this.encryption.encrypt(secret, aad(user.id));
    await this.db.transaction(async (tx) => {
      const existing = await this.lock(tx, user.id);
      if (existing?.confirmedAt) {
        throw new ApiException(
          'MFA_ALREADY_ENROLLED',
          'Two-factor authentication is already enabled; disable it before enrolling a new authenticator',
          409,
        );
      }
      await tx
        .insert(userMfa)
        .values({ userId: user.id, secretCiphertext: ciphertext })
        .onConflictDoUpdate({
          target: userMfa.userId,
          set: {
            secretCiphertext: ciphertext,
            confirmedAt: null,
            lastUsedStep: null,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: 'admin',
          action: 'mfa.enrolment_started',
          targetType: 'user',
          targetId: user.id,
          ip: meta.ip ?? null,
        },
        tx,
      );
    });
    return {
      secret,
      otpauthUri: otpauthUri({ issuer: this.issuer, account: user.email, secret }),
      issuer: this.issuer,
      account: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    };
  }

  /** Step 2: a valid code proves the authenticator holds the secret; returns the recovery codes once. */
  async confirmEnrolment(
    user: AuthenticatedUser,
    input: MfaEnrolConfirmRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<MfaEnrolConfirmResponse> {
    this.assertPrivileged(user);
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.lock(tx, user.id);
      if (!row) throw new ApiException('MFA_NOT_ENROLLED', 'Start the enrolment first', 409);
      if (row.confirmedAt) {
        throw new ApiException(
          'MFA_ALREADY_ENROLLED',
          'Two-factor authentication is already enabled',
          409,
        );
      }
      const check = await this.checkCode(tx, row, input.code, now);
      if ('error' in check) return check;
      await tx
        .update(userMfa)
        .set({
          confirmedAt: now,
          lastUsedStep: check.step,
          failedAttempts: 0,
          lockedUntil: null,
          recoveryCodesGeneratedAt: now,
        })
        .where(eq(userMfa.userId, user.id));
      const codes = await this.replaceRecoveryCodes(tx, user.id);
      // The session that enrolled becomes a verified one, so the admin can carry on.
      await this.refreshTokens.markFamilyMfaVerified(user.sessionId, now, tx);
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: 'admin',
          action: 'mfa.enrolled',
          targetType: 'user',
          targetId: user.id,
          ip: meta.ip ?? null,
          metadata: { recoveryCodes: codes.length },
        },
        tx,
      );
      const full = await this.users.findById(user.id, tx);
      if (full) {
        await this.email.enqueue(mfaEnabledEmail({ to: full.email, fullName: full.fullName }), tx);
      }
      return { codes };
    });
    if ('error' in outcome) throw outcome.error;
    const { token, expiresIn } = await this.tokens.signAccessToken({
      id: user.id,
      roles: user.roles,
      sessionId: user.sessionId,
      mfaVerified: true,
    });
    this.logger.info({ userId: user.id }, 'MFA enrolled');
    return {
      recoveryCodes: outcome.codes,
      generatedAt: now.toISOString(),
      session: { tokenType: 'Bearer', accessToken: token, expiresIn },
    };
  }

  // ----------------------------------------------------- login verification

  /** Verifies a TOTP code for an enrolled account (login challenge). */
  async verifyChallengeCode(userId: string, code: string, now = new Date()): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.lock(tx, userId);
      if (!row?.confirmedAt) return { error: MfaService.notEnrolled() };
      const check = await this.checkCode(tx, row, code, now);
      if ('error' in check) return check;
      await tx
        .update(userMfa)
        .set({ lastUsedStep: check.step, failedAttempts: 0, lockedUntil: null })
        .where(eq(userMfa.userId, userId));
      return check;
    });
    if ('error' in outcome) throw outcome.error;
  }

  /** Consumes one recovery code (login without the authenticator); audited and e-mailed. */
  async consumeRecoveryCode(
    userId: string,
    code: string,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<{ remaining: number }> {
    const hash = hashRecoveryCode(code);
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.lock(tx, userId);
      if (!row?.confirmedAt) return { error: MfaService.notEnrolled() };
      const locked = MfaService.lockedError(row, now);
      if (locked) return { error: locked };
      const [claimed] = await tx
        .update(userMfaRecoveryCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(userMfaRecoveryCodes.userId, userId),
            eq(userMfaRecoveryCodes.codeHash, hash),
            isNull(userMfaRecoveryCodes.usedAt),
          ),
        )
        .returning({ id: userMfaRecoveryCodes.id });
      if (!claimed) {
        await this.recordFailure(tx, row, now);
        return {
          error: new ApiException('MFA_CODE_INVALID', 'That recovery code is not valid', 401),
        };
      }
      await tx
        .update(userMfa)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(userMfa.userId, userId));
      const remaining = await this.countRemainingCodes(userId, tx);
      await this.audit.record(
        {
          actorUserId: userId,
          actorType: 'admin',
          action: 'mfa.recovery_code_used',
          targetType: 'user',
          targetId: userId,
          ip: meta.ip ?? null,
          metadata: { remaining },
        },
        tx,
      );
      const full = await this.users.findById(userId, tx);
      if (full) {
        await this.email.enqueue(
          mfaRecoveryCodeUsedEmail({ to: full.email, fullName: full.fullName, remaining }),
          tx,
        );
      }
      return { remaining };
    });
    if ('error' in outcome) throw outcome.error;
    this.logger.warn({ userId, remaining: outcome.remaining }, 'MFA recovery code used');
    return outcome;
  }

  // ------------------------------------------------------------ management

  /** Password + current code; removes the factor and every session's verified mark. */
  async disable(
    user: AuthenticatedUser,
    input: MfaStepUpRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<void> {
    await this.assertPassword(user.id, input.password);
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.lock(tx, user.id);
      if (!row?.confirmedAt) return { error: MfaService.notEnrolled() };
      const check = await this.checkCode(tx, row, input.code, now);
      if ('error' in check) return check;
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, user.id));
      await tx.delete(userMfa).where(eq(userMfa.userId, user.id));
      await this.refreshTokens.clearMfaForUser(user.id, tx);
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: 'admin',
          action: 'mfa.disabled',
          targetType: 'user',
          targetId: user.id,
          ip: meta.ip ?? null,
        },
        tx,
      );
      const full = await this.users.findById(user.id, tx);
      if (full) {
        await this.email.enqueue(mfaDisabledEmail({ to: full.email, fullName: full.fullName }), tx);
      }
      return { ok: true as const };
    });
    if ('error' in outcome) throw outcome.error;
    this.logger.info({ userId: user.id }, 'MFA disabled');
  }

  /** Password + current code; invalidates every previous recovery code. */
  async regenerateRecoveryCodes(
    user: AuthenticatedUser,
    input: MfaStepUpRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<MfaRecoveryCodes> {
    await this.assertPassword(user.id, input.password);
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.lock(tx, user.id);
      if (!row?.confirmedAt) return { error: MfaService.notEnrolled() };
      const check = await this.checkCode(tx, row, input.code, now);
      if ('error' in check) return check;
      await tx
        .update(userMfa)
        .set({
          lastUsedStep: check.step,
          failedAttempts: 0,
          lockedUntil: null,
          recoveryCodesGeneratedAt: now,
        })
        .where(eq(userMfa.userId, user.id));
      const codes = await this.replaceRecoveryCodes(tx, user.id);
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: 'admin',
          action: 'mfa.recovery_codes_regenerated',
          targetType: 'user',
          targetId: user.id,
          ip: meta.ip ?? null,
          metadata: { recoveryCodes: codes.length },
        },
        tx,
      );
      return { codes };
    });
    if ('error' in outcome) throw outcome.error;
    return { recoveryCodes: outcome.codes, generatedAt: now.toISOString() };
  }

  // ---------------------------------------------------------------- helpers

  private assertPrivileged(user: AuthenticatedUser): void {
    if (!isPrivileged(user.roles)) {
      throw new ApiException(
        'FORBIDDEN',
        'Two-factor authentication is available to administrator accounts',
        403,
      );
    }
  }

  private async assertPassword(userId: string, password: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || !(await this.passwords.verify(user.passwordHash, password))) {
      throw new ApiException('INVALID_CREDENTIALS', 'Incorrect password', 401);
    }
  }

  private async lock(tx: DatabaseExecutor, userId: string): Promise<UserMfa | undefined> {
    const [row] = await tx.select().from(userMfa).where(eq(userMfa.userId, userId)).for('update');
    return row;
  }

  private static notEnrolled(): ApiException {
    return new ApiException(
      'MFA_NOT_ENROLLED',
      'Two-factor authentication is not enabled for this account',
      409,
    );
  }

  private static lockedError(row: UserMfa, now: Date): ApiException | null {
    if (!row.lockedUntil || row.lockedUntil <= now) return null;
    const minutes = Math.max(1, Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60_000));
    return new ApiException(
      'MFA_LOCKED',
      `Too many incorrect codes; try again in ${minutes} minute${minutes === 1 ? '' : 's'}`,
      429,
    );
  }

  /**
   * Verifies a TOTP code against the stored secret. On failure the counter is
   * written inside the caller's transaction and the error is *returned* so the
   * caller commits before throwing.
   */
  private async checkCode(
    tx: DatabaseExecutor,
    row: UserMfa,
    code: string,
    now: Date,
  ): Promise<CodeCheck> {
    const locked = MfaService.lockedError(row, now);
    if (locked) return { error: locked };
    const secret = this.encryption.decrypt(row.secretCiphertext, aad(row.userId));
    const result = verifyTotp(secret, code, {
      nowMs: now.getTime(),
      lastUsedStep: row.lastUsedStep,
    });
    if (!result.valid) {
      await this.recordFailure(tx, row, now);
      return { error: new ApiException('MFA_CODE_INVALID', 'That code is not valid', 401) };
    }
    return { step: result.step };
  }

  private async recordFailure(tx: DatabaseExecutor, row: UserMfa, now: Date): Promise<void> {
    const failures = row.failedAttempts + 1;
    const lock = failures >= MFA_MAX_FAILED_ATTEMPTS;
    await tx
      .update(userMfa)
      .set({
        failedAttempts: lock ? 0 : failures,
        lockedUntil: lock ? new Date(now.getTime() + MFA_LOCK_MINUTES * 60_000) : row.lockedUntil,
      })
      .where(eq(userMfa.userId, row.userId));
    if (lock) {
      await this.audit.record(
        {
          actorUserId: row.userId,
          actorType: 'admin',
          action: 'mfa.locked',
          targetType: 'user',
          targetId: row.userId,
          metadata: { minutes: MFA_LOCK_MINUTES, attempts: failures },
        },
        tx,
      );
      this.logger.warn({ userId: row.userId }, 'MFA locked after repeated incorrect codes');
    }
  }

  private async countRemainingCodes(
    userId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<number> {
    const [row] = await executor
      .select({ remaining: sql<number>`count(*)::int` })
      .from(userMfaRecoveryCodes)
      .where(and(eq(userMfaRecoveryCodes.userId, userId), isNull(userMfaRecoveryCodes.usedAt)));
    return row?.remaining ?? 0;
  }

  private async replaceRecoveryCodes(tx: DatabaseExecutor, userId: string): Promise<string[]> {
    await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
    const codes = Array.from({ length: MFA_RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
    await tx
      .insert(userMfaRecoveryCodes)
      .values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
    return codes;
  }
}
