/**
 * Emergency MFA reset (Phase 10, OPERATIONS_RUNBOOK §10). For an administrator
 * who lost both the authenticator and the recovery codes. Runs only with
 * direct database access, never through the API; removes the factor, drops
 * the verified mark from every session and signs the account out everywhere
 * so a possible hijacker cannot ride along. Audited `mfa.reset` with the reason.
 *
 *   pnpm admin:mfa-reset --email ops@example.lk --reason "Lost phone, identity confirmed by call on 2026-10-17"
 */
import {
  auditEvents,
  createDatabase,
  loadRootEnv,
  refreshTokens,
  requireEnv,
  userMfa,
  userMfaRecoveryCodes,
  users,
  type Database,
} from '@vrp/database';
import { eq } from 'drizzle-orm';

export class MfaResetError extends Error {}

export interface MfaResetResult {
  userId: string;
  hadFactor: boolean;
}

export async function resetMfa(
  db: Database,
  email: string,
  reason: string,
): Promise<MfaResetResult> {
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
    throw new MfaResetError('A valid e-mail address is required');
  }
  if (reason.trim().length < 10) {
    throw new MfaResetError('A reason of at least 10 characters is required (it is audited)');
  }
  const [user] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);
  if (!user) throw new MfaResetError('No account exists for that e-mail address');

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(userMfa)
      .where(eq(userMfa.userId, user.id))
      .returning({ userId: userMfa.userId });
    await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, user.id));
    const now = new Date();
    await tx
      .update(refreshTokens)
      .set({ mfaVerifiedAt: null, revokedAt: now })
      .where(eq(refreshTokens.userId, user.id));
    await tx.update(users).set({ sessionsRevokedAt: now }).where(eq(users.id, user.id));
    await tx.insert(auditEvents).values({
      actorUserId: null,
      actorType: 'system',
      action: 'mfa.reset',
      targetType: 'user',
      targetId: user.id,
      reason: reason.trim(),
      metadata: { via: 'cli', hadFactor: removed.length > 0 },
    });
    return { userId: user.id, hadFactor: removed.length > 0 };
  });
}

function parseArgs(argv: string[]): { email: string; reason: string } {
  let email = '';
  let reason = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') email = argv[i + 1] ?? '';
    if (argv[i] === '--reason') reason = argv[i + 1] ?? '';
  }
  if (!email || !reason) {
    throw new MfaResetError(
      'Usage: admin:mfa-reset --email <address> --reason "<why, ≥ 10 chars>"',
    );
  }
  return { email, reason };
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

async function main(): Promise<void> {
  loadRootEnv();
  const { email, reason } = parseArgs(process.argv.slice(2));
  const handle = createDatabase({
    url: requireEnv('DATABASE_URL'),
    max: 1,
    applicationName: 'vrp-mfa-reset',
  });
  try {
    const result = await resetMfa(handle.db, email, reason);
    console.warn(
      result.hadFactor
        ? `MFA removed for ${maskEmail(email)} (user ${result.userId}); every session was signed out. The user must enrol again before using administrator features.`
        : `${maskEmail(email)} had no authenticator enrolled; sessions were signed out anyway and the reset was audited.`,
    );
  } finally {
    await handle.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
