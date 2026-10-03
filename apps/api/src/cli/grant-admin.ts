/**
 * Admin bootstrap. Grants `admin` (or `super_admin`) to an existing, verified
 * account. Runs only with direct database access (never via the API):
 *
 *   pnpm admin:grant --email you@example.com [--role super_admin]
 *
 * Idempotent: granting an existing role changes nothing. Writes an audit event.
 */
import {
  auditEvents,
  createDatabase,
  loadRootEnv,
  requireEnv,
  users,
  type Database,
  type UserRole,
} from '@vrp/database';
import { eq } from 'drizzle-orm';

export type GrantableRole = Extract<UserRole, 'admin' | 'super_admin'>;

export interface GrantResult {
  userId: string;
  roles: UserRole[];
  changed: boolean;
}

export class GrantAdminError extends Error {}

export async function grantRole(
  db: Database,
  email: string,
  role: GrantableRole,
): Promise<GrantResult> {
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
    throw new GrantAdminError('A valid e-mail address is required');
  }
  const [user] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);
  if (!user) throw new GrantAdminError('No account exists for that e-mail address');
  if (user.status !== 'active')
    throw new GrantAdminError(`Account is ${user.status}; refusing to grant roles`);
  if (!user.emailVerifiedAt)
    throw new GrantAdminError('Account e-mail is not verified; refusing to grant roles');

  if (user.roles.includes(role)) {
    return { userId: user.id, roles: user.roles, changed: false };
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ roles: [...user.roles, role] })
      .where(eq(users.id, user.id))
      .returning({ roles: users.roles });
    await tx.insert(auditEvents).values({
      actorUserId: null,
      actorType: 'system',
      action: 'admin.role_granted',
      targetType: 'user',
      targetId: user.id,
      metadata: { role, via: 'cli' },
    });
    return { userId: user.id, roles: updated?.roles ?? [...user.roles, role], changed: true };
  });
}

function parseArgs(argv: string[]): { email: string; role: GrantableRole } {
  let email = '';
  let role: GrantableRole = 'admin';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email') email = argv[i + 1] ?? '';
    if (arg === '--role') {
      const value = argv[i + 1];
      if (value !== 'admin' && value !== 'super_admin') {
        throw new GrantAdminError('--role must be admin or super_admin');
      }
      role = value;
    }
  }
  if (!email)
    throw new GrantAdminError('Usage: admin:grant --email <address> [--role admin|super_admin]');
  return { email, role };
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

async function main(): Promise<void> {
  loadRootEnv();
  const { email, role } = parseArgs(process.argv.slice(2));
  const handle = createDatabase({
    url: requireEnv('DATABASE_URL'),
    max: 1,
    applicationName: 'vrp-admin-grant',
  });
  try {
    const result = await grantRole(handle.db, email, role);
    console.warn(
      result.changed
        ? `Granted ${role} to ${maskEmail(email)} (user ${result.userId}); roles are now ${result.roles.join(', ')}`
        : `${maskEmail(email)} already has ${role}; nothing changed`,
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
