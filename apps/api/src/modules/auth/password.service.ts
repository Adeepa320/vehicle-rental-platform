import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@vrp/contracts';
import * as argon2 from 'argon2';

import type { Env } from '../../config/env.schema';

/**
 * Short deny-list of extremely common passwords that still satisfy the length
 * rule. A breached-password (k-anonymity) check is scheduled for Phase 10.
 */
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '12345678910',
  'password12',
  'password123',
  'password1234',
  'qwertyuiop',
  'qwerty1234',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'srilanka123',
  'colombo123',
]);

@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions;
  private dummyHash: Promise<string> | undefined;

  constructor(config: ConfigService<Env, true>) {
    // Argon2id per SECURITY_AND_PRIVACY.md §2.1 (64 MiB, 3 iterations, parallelism 1 by default).
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.get('ARGON2_MEMORY_KIB', { infer: true }),
      timeCost: config.get('ARGON2_TIME_COST', { infer: true }),
      parallelism: 1,
    };
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /** Constant-time verification; malformed hashes count as a mismatch. */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Spends the same CPU time as a real verification so a login for an unknown
   * e-mail is not measurably faster than one with a wrong password.
   */
  async verifyDummy(plain: string): Promise<false> {
    const dummy = (this.dummyHash ??= argon2.hash('timing-equalisation-placeholder', this.options));
    await argon2.verify(await dummy, plain).catch(() => false);
    return false;
  }

  /**
   * Policy beyond the schema's length rule. Returns a human-readable issue or
   * `null` when the password is acceptable.
   */
  checkPolicy(
    password: string,
    context: { email?: string; fullName?: string } = {},
  ): string | null {
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return `must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;
    }
    const lower = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lower)) {
      return 'is too common; choose something harder to guess';
    }
    if (/^(.)\1+$/.test(password)) {
      return 'must not repeat a single character';
    }
    const localPart = context.email?.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
      return 'must not contain your email address';
    }
    const name = context.fullName?.trim().toLowerCase();
    if (name && name.length >= 4 && lower.includes(name)) {
      return 'must not contain your name';
    }
    return null;
  }
}
