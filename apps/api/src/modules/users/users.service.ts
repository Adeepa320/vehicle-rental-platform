import { Inject, Injectable } from '@nestjs/common';
import type { UpdateProfileRequest } from '@vrp/contracts';
import { users, type Database, type DatabaseExecutor, type User } from '@vrp/database';
import { eq, sql } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  preferredLanguage?: string;
  countryCode?: string;
  termsVersion: string;
}

/** Subset the auth guard needs on every request. */
export interface AuthUserRow {
  id: string;
  email: string;
  roles: User['roles'];
  status: User['status'];
  sessionsRevokedAt: Date | null;
}

/** PostgreSQL unique-violation detection across Drizzle's error wrapping. */
export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string, executor: DatabaseExecutor = this.db): Promise<User | undefined> {
    const [user] = await executor.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  /** `email` is a citext column, so the match is case-insensitive. */
  async findByEmail(
    email: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<User | undefined> {
    const [user] = await executor.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async findAuthUserById(id: string): Promise<AuthUserRow | undefined> {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        roles: users.roles,
        status: users.status,
        sessionsRevokedAt: users.sessionsRevokedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user;
  }

  /**
   * Creates a customer account. Roles are always `{customer}` here; privileged
   * roles are granted only through admin tooling (later phase).
   */
  async create(executor: DatabaseExecutor, input: CreateUserInput): Promise<User> {
    try {
      const [user] = await executor
        .insert(users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          preferredLanguage: input.preferredLanguage ?? 'en',
          countryCode: input.countryCode ?? null,
          termsAcceptedAt: new Date(),
          termsVersion: input.termsVersion,
        })
        .returning();
      if (!user) throw new Error('Failed to create user');
      return user;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException(
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists',
          409,
        );
      }
      throw error;
    }
  }

  async markEmailVerified(executor: DatabaseExecutor, userId: string): Promise<User> {
    const [user] = await executor
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, userId))
      .returning();
    if (!user) throw new ApiException('TOKEN_INVALID', 'This link is invalid', 400);
    return user;
  }

  async recordLogin(userId: string): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }

  /**
   * Sets a new password hash and invalidates every existing session: refresh
   * tokens are revoked by the caller and `sessions_revoked_at` makes the auth
   * guard reject access tokens issued before this instant. A successful reset
   * also proves e-mail ownership, so an unverified address becomes verified.
   */
  async setPassword(
    executor: DatabaseExecutor,
    userId: string,
    passwordHash: string,
  ): Promise<User> {
    const [user] = await executor
      .update(users)
      .set({
        passwordHash,
        sessionsRevokedAt: new Date(),
        // Database clock: binding a JS Date inside coalesce() leaves $1 untyped for PostgreSQL.
        emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!user) throw new ApiException('TOKEN_INVALID', 'This link is invalid', 400);
    return user;
  }

  async revokeSessions(executor: DatabaseExecutor, userId: string): Promise<void> {
    await executor.update(users).set({ sessionsRevokedAt: new Date() }).where(eq(users.id, userId));
  }

  /** Profile fields only; e-mail, password and roles have dedicated flows. */
  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.phone !== undefined ? { phoneE164: patch.phone, phoneVerifiedAt: null } : {}),
        ...(patch.preferredLanguage !== undefined
          ? { preferredLanguage: patch.preferredLanguage }
          : {}),
        ...(patch.preferredCurrency !== undefined
          ? { preferredCurrency: patch.preferredCurrency }
          : {}),
        ...(patch.countryCode !== undefined ? { countryCode: patch.countryCode } : {}),
      })
      .where(eq(users.id, userId))
      .returning();
    if (!user) throw new ApiException('NOT_FOUND', 'User not found', 404);
    return user;
  }
}
