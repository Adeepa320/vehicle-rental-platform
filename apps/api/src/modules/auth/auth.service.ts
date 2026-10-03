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
import { EmailService } from '../notifications/email/email.service';
import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../notifications/email/templates';
import { toPublicUser } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import type { RequestMeta } from './auth.types';
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
    private readonly email: EmailService,
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

  async login(input: LoginRequest, meta: RequestMeta): Promise<SessionResult> {
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

    const issued = await this.db.transaction((tx) =>
      this.refreshTokens.issue(tx, {
        userId: user.id,
        roles: user.roles,
        client: input.client,
        ...meta,
      }),
    );
    await this.users.recordLogin(user.id);
    this.logger.info({ userId: user.id, client: input.client }, 'User logged in');
    return this.buildSession(user, issued.record.familyId, input.client, {
      raw: issued.raw,
      expiresAt: issued.record.expiresAt,
    });
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<SessionResult> {
    const { previous, issued } = await this.refreshTokens.rotate(rawRefreshToken, meta);
    const user = await this.users.findById(previous.userId);
    if (!user || user.status !== 'active') {
      await this.refreshTokens.revokeFamily(previous.familyId);
      if (user?.status === 'suspended') {
        throw new ApiException('ACCOUNT_SUSPENDED', 'This account has been suspended', 403);
      }
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    if (user.sessionsRevokedAt && previous.createdAt < user.sessionsRevokedAt) {
      await this.refreshTokens.revokeFamily(previous.familyId);
      throw new ApiException('REFRESH_INVALID', 'Refresh token is invalid or expired', 401);
    }
    return this.buildSession(user, previous.familyId, previous.client as AuthClient, {
      raw: issued.raw,
      expiresAt: issued.record.expiresAt,
    });
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.refreshTokens.revokeRaw(rawRefreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.refreshTokens.revokeAllForUser(userId, tx);
      await this.users.revokeSessions(tx, userId);
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
  ): Promise<SessionResult> {
    const { token, expiresIn } = await this.tokens.signAccessToken({
      id: user.id,
      roles: user.roles,
      sessionId,
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

  private assertPasswordPolicy(password: string, context: { email: string; fullName: string }) {
    const issue = this.passwords.checkPolicy(password, context);
    if (issue) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'password', issue },
      ]);
    }
  }

  private static invalidCredentials(): ApiException {
    return new ApiException('INVALID_CREDENTIALS', 'Incorrect email or password', 401);
  }
}
