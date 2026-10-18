import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CURRENT_TERMS_VERSION,
  type AuthClient,
  type AuthSessionResponse,
  type LoginRequest,
  type RegisterRequest,
  type RegisterResponse,
  type VerifyEmailResponse,
} from '@vrp/contracts';
import type { Database, DatabaseExecutor, User } from '@vrp/database';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';
import { AuditService, type AuditActorType } from '../audit/audit.service';
import { EmailService } from '../notifications/email/email.service';
import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../notifications/email/templates';
import { toPublicUser } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import type { RequestMeta } from './auth.types';
import { MfaService } from './mfa/mfa.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

/** Everything the controller needs to answer a login/refresh and set the cookie. */
export interface SessionResult {
  session: AuthSessionResponse;
  client: AuthClient;
  refreshToken: { raw: string; expiresAt: Date };
}

/** A password-only login of an MFA-enrolled account: no session yet, only a signed challenge (Phase 10). */
export interface MfaChallengeResult {
  mfaRequired: true;
  challengeToken: string;
  expiresIn: number;
}

export type LoginResult = SessionResult | MfaChallengeResult;

@Injectable()
export class AuthService {
  private readonly webAppUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly mfa: MfaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthService.name);
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------- register

  async register(input: RegisterRequest, meta: RequestMeta): Promise<RegisterResponse> {
    this.assertPasswordPolicy(input.password, { email: input.email, fullName: input.fullName });
    const passwordHash = await this.passwords.hash(input.password);

    const { user, emailSent } = await this.db.transaction(async (tx) => {
      const created = await this.users.create(tx, {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        preferredLanguage: input.preferredLanguage,
        countryCode: input.countryCode,
        termsVersion: CURRENT_TERMS_VERSION,
      });
      const sent = await this.sendVerification(tx, created, meta);
      return { user: created, emailSent: sent };
    });

    this.logger.info({ userId: user.id }, 'User registered');
    return { user: toPublicUser(user), verification: { emailSent } };
  }

  /** Enumeration-safe: silently does nothing for unknown, verified or inactive accounts. */
  async resendVerification(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.emailVerifiedAt || user.status !== 'active') return;
    await this.db.transaction((tx) => this.sendVerification(tx, user, meta));
  }

  async verifyEmail(rawToken: string): Promise<VerifyEmailResponse> {
    return this.db.transaction(async (tx) => {
      const { userId } = await this.oneTimeTokens.consume(tx, rawToken, 'verify_email');
      const user = await this.users.markEmailVerified(tx, userId);
      this.logger.info({ userId }, 'Email verified');
      return { verified: true, email: user.email };
    });
  }

  // ------------------------------------------------------------------- login

  async login(input: LoginRequest, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      throw AuthService.invalidCredentials();
    }
    const valid = await this.passwords.verify(user.passwordHash, input.password);
    if (!valid || user.status === 'deleted') {
      throw AuthService.invalidCredentials();
    }
    if (user.status === 'suspended') {
      throw new ApiException('ACCOUNT_SUSPENDED', 'This account has been suspended', 403);
    }
    if (!user.emailVerifiedAt) {
      throw new ApiException(
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address before signing in',
        403,
      );
    }

    if (await this.mfa.isEnrolled(user.id)) {
      // The password is proven; the session is issued only by the MFA challenge.
      const challenge = await this.tokens.signMfaChallenge({
        userId: user.id,
        client: input.client,
      });
      this.logger.info({ userId: user.id, client: input.client }, 'Login awaiting MFA');
      return { mfaRequired: true, challengeToken: challenge.token, expiresIn: challenge.expiresIn };
    }

    const issued = await this.db.transaction(async (tx) => {
      // A password change that committed after the verification above wins.
      const locked = await this.users.lockAuthState(tx, user.id);
      if (locked?.passwordHash !== user.passwordHash) return null;
      return this.refreshTokens.issue(tx, {
        userId: user.id,
        roles: user.roles,
        client: input.client,
        ...meta,
      });
    });
    if (!issued) throw AuthService.invalidCredentials();
    await this.users.recordLogin(user.id);
    this.logger.info({ userId: user.id, client: input.client }, 'User logged in');
    return this.buildSession(user, issued.record.familyId, input.client, {
      raw: issued.raw,
      expiresAt: issued.record.expiresAt,
    });
  }

  /**
   * Second half of a login for an enrolled account (Phase 10): the signed
   * challenge names the user and client; a TOTP code or a one-time recovery
   * code completes it. The session issued here carries the verified factor.
   */
  async completeMfaChallenge(
    input: { challengeToken: string; code?: string; recoveryCode?: string },
    meta: RequestMeta,
    now = new Date(),
  ): Promise<SessionResult> {
    const claims = await this.tokens.verifyMfaChallenge(input.challengeToken).catch(() => {
      throw new ApiException(
        'MFA_CHALLENGE_INVALID',
        'This sign-in attempt has expired; enter your e-mail and password again',
        401,
      );
    });
    const user = await this.users.findById(claims.sub);
    if (!user || user.status === 'deleted') {
      throw new ApiException(
        'MFA_CHALLENGE_INVALID',
        'This sign-in attempt is no longer valid',
        401,
      );
    }
    if (user.status === 'suspended') {
      throw new ApiException('ACCOUNT_SUSPENDED', 'This account has been suspended', 403);
    }
    if (input.recoveryCode !== undefined) {
      await this.mfa.consumeRecoveryCode(user.id, input.recoveryCode, meta, now);
    } else {
      await this.mfa.verifyChallengeCode(user.id, input.code ?? '', now);
    }
    const issued = await this.db.transaction(async (tx) => {
      // A challenge minted before a password change / logout-all cannot open a session after it.
      const locked = await this.users.lockAuthState(tx, user.id);
      if (
        !locked ||
        // Second precision, as the access-token guard compares `iat`.
        (locked.sessionsRevokedAt &&
          claims.iat < Math.floor(locked.sessionsRevokedAt.getTime() / 1000))
      ) {
        return null;
      }
      return this.refreshTokens.issue(tx, {
        userId: user.id,
        roles: user.roles,
        client: claims.client,
        mfaVerifiedAt: now,
        ...meta,
      });
    });
    if (!issued) {
      throw new ApiException(
        'MFA_CHALLENGE_INVALID',
        'This sign-in attempt is no longer valid',
        401,
      );
    }
    await this.users.recordLogin(user.id);
    this.logger.info(
      { userId: user.id, client: claims.client, method: input.recoveryCode ? 'recovery' : 'totp' },
      'User logged in with MFA',
    );
    return this.buildSession(
      user,
      issued.record.familyId,
      claims.client,
      { raw: issued.raw, expiresAt: issued.record.expiresAt },
      true,
    );
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<SessionResult> {
    const { previous, issued } = await this.refreshTokens.rotate(rawRefreshToken, meta);
    const session = { userId: previous.userId, familyId: previous.familyId };
    const user = await this.users.findById(previous.userId);
    if (!user || user.status !== 'active') {
      await this.refreshTokens.revokeFamily(session);
      if (user?.status === 'suspended') {
        throw new ApiException('ACCOUNT_SUSPENDED', 'This account has been suspended', 403);
      }
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    if (user.sessionsRevokedAt && previous.createdAt < user.sessionsRevokedAt) {
      await this.refreshTokens.revokeFamily(session);
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    return this.buildSession(
      user,
      previous.familyId,
      previous.client as AuthClient,
      { raw: issued.raw, expiresAt: issued.record.expiresAt },
      issued.record.mfaVerifiedAt !== null,
    );
  }

  /**
   * Ends the caller's current logical session only: the refresh token's family
   * and, when a valid bearer token came along, the session it is bound to. Access
   * tokens of that session fail on their next request; other sessions stay valid.
   */
  async logout(
    rawRefreshToken: string | undefined,
    bearerSession?: { userId: string; familyId: string },
  ): Promise<void> {
    if (rawRefreshToken) await this.refreshTokens.revokeFamilyOfRaw(rawRefreshToken);
    if (bearerSession) await this.refreshTokens.revokeFamily(bearerSession);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // User row first (the lock rotation waits on), then every refresh token.
      await this.users.revokeSessions(tx, userId);
      await this.refreshTokens.revokeAllForUser(userId, tx);
    });
    this.logger.info({ userId }, 'All sessions revoked');
  }

  // --------------------------------------------------------- password reset

  /** Enumeration-safe: silently does nothing for unknown or inactive accounts. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== 'active') return;
    await this.db.transaction(async (tx) => {
      const issued = await this.oneTimeTokens.issue(tx, user.id, 'password_reset', meta);
      if ('capped' in issued) return;
      await this.email.enqueue(
        passwordResetEmail({
          to: user.email,
          fullName: user.fullName,
          link: this.link('/reset-password', issued.raw),
          expiresInMinutes: Math.round(this.oneTimeTokens.ttlFor('password_reset') / 60_000),
        }),
        tx,
      );
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { userId } = await this.oneTimeTokens.consume(tx, rawToken, 'password_reset');
      const user = await this.users.findById(userId, tx);
      if (!user || user.status !== 'active') {
        throw new ApiException('TOKEN_INVALID', 'This link is invalid', 400);
      }
      this.assertPasswordPolicy(newPassword, { email: user.email, fullName: user.fullName });
      const passwordHash = await this.passwords.hash(newPassword);
      await this.users.setPassword(tx, userId, passwordHash);
      await this.refreshTokens.revokeAllForUser(userId, tx);
      await this.email.enqueue(
        passwordChangedEmail({ to: user.email, fullName: user.fullName }),
        tx,
      );
      this.logger.info({ userId }, 'Password reset; all sessions revoked');
    });
  }

  // --------------------------------------------------------- password change

  /**
   * Signed-in password change (Phase 10, ASVS V6.2.3). The caller comes from the
   * access token. The current password must verify, the new one passes the same
   * policy as registration and reset and must differ. On success the hash, the
   * revocation marker, every refresh token, the audit event and the notification
   * commit together: every session — including this one — is signed out.
   */
  async changePassword(
    caller: { id: string; roles: readonly string[] },
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.users.findById(caller.id);
    if (!user || user.status !== 'active') {
      throw new ApiException('UNAUTHENTICATED', 'Authentication required', 401);
    }
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw AuthService.currentPasswordInvalid();
    }
    if (input.newPassword === input.currentPassword) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'newPassword', issue: 'must be different from your current password' },
      ]);
    }
    this.assertPasswordPolicy(
      input.newPassword,
      { email: user.email, fullName: user.fullName },
      'newPassword',
    );
    const passwordHash = await this.passwords.hash(input.newPassword);

    await this.db.transaction(async (tx) => {
      // A change that committed after the verification above wins; the password
      // this caller proved is no longer the current one.
      const locked = await this.users.lockAuthState(tx, user.id);
      if (!locked || locked.passwordHash !== user.passwordHash || locked.status !== 'active') {
        throw AuthService.currentPasswordInvalid();
      }
      await this.users.setPassword(tx, user.id, passwordHash);
      await this.refreshTokens.revokeAllForUser(user.id, tx);
      await this.audit.record(
        {
          actorUserId: user.id,
          actorType: auditActorTypeFor(caller.roles),
          action: 'user.password_changed',
          targetType: 'user',
          targetId: user.id,
          ip: meta.ip ?? null,
          metadata: { sessionsRevoked: true },
        },
        tx,
      );
      await this.email.enqueue(
        passwordChangedEmail({ to: user.email, fullName: user.fullName }),
        tx,
      );
    });
    this.logger.info({ userId: user.id }, 'Password changed; all sessions revoked');
  }

  // ---------------------------------------------------------------- helpers

  private async sendVerification(
    tx: DatabaseExecutor,
    user: User,
    meta: RequestMeta,
  ): Promise<boolean> {
    const issued = await this.oneTimeTokens.issue(tx, user.id, 'verify_email', meta);
    if ('capped' in issued) return false;
    await this.email.enqueue(
      verificationEmail({
        to: user.email,
        fullName: user.fullName,
        link: this.link('/verify-email', issued.raw),
        expiresInHours: Math.round(this.oneTimeTokens.ttlFor('verify_email') / 3_600_000),
      }),
      tx,
    );
    return true;
  }

  private async buildSession(
    user: User,
    sessionId: string,
    client: AuthClient,
    refreshToken: { raw: string; expiresAt: Date },
    mfaVerified = false,
  ): Promise<SessionResult> {
    const { token, expiresIn } = await this.tokens.signAccessToken({
      id: user.id,
      roles: user.roles,
      sessionId,
      mfaVerified,
    });
    return {
      client,
      refreshToken,
      session: {
        tokenType: 'Bearer',
        accessToken: token,
        expiresIn,
        user: toPublicUser(user),
        ...(client === 'mobile' ? { refreshToken: refreshToken.raw } : {}),
      },
    };
  }

  private link(path: string, token: string): string {
    return `${this.webAppUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  private assertPasswordPolicy(
    password: string,
    context: { email: string; fullName: string },
    field = 'password',
  ) {
    const issue = this.passwords.checkPolicy(password, context);
    if (issue) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [{ field, issue }]);
    }
  }

  private static invalidCredentials(): ApiException {
    return new ApiException('INVALID_CREDENTIALS', 'Incorrect email or password', 401);
  }

  /** 400, not 401: the caller is authenticated, and a 401 would make clients refresh and retry. */
  private static currentPasswordInvalid(): ApiException {
    return new ApiException('CURRENT_PASSWORD_INVALID', 'The current password is incorrect', 400, [
      { field: 'currentPassword', issue: 'is incorrect' },
    ]);
  }
}

function auditActorTypeFor(roles: readonly string[]): AuditActorType {
  if (roles.includes('admin') || roles.includes('super_admin')) return 'admin';
  if (roles.includes('provider')) return 'provider';
  return 'customer';
}
