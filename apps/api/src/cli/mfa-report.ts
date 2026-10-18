/**
 * Admin MFA readiness report (Phase 10, go-live checklist). Lists every active
 * privileged account with its roles and whether an authenticator is enrolled;
 * never touches or prints secrets. Runs with direct database access only:
 *
 *   pnpm admin:mfa-report            # table
 *   pnpm admin:mfa-report --strict   # exit 1 when any active admin lacks a confirmed factor
 *   pnpm admin:mfa-report --json     # machine-readable (used by production:check)
 */
import {
  createDatabase,
  loadRootEnv,
  requireEnv,
  userMfa,
  users,
  type Database,
} from '@vrp/database';
import { arrayOverlaps, eq, sql } from 'drizzle-orm';

export interface MfaReportRow {
  userId: string;
  /** Masked: first character of the local part only. */
  email: string;
  roles: string[];
  status: string;
  mfaEnrolled: boolean;
  confirmedAt: string | null;
  lastLoginAt: string | null;
}

export interface MfaReport {
  generatedAt: string;
  rows: MfaReportRow[];
  /** Active privileged accounts without a confirmed factor. */
  missing: number;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function buildMfaReport(db: Database): Promise<MfaReport> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      roles: users.roles,
      status: users.status,
      confirmedAt: userMfa.confirmedAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .leftJoin(userMfa, eq(userMfa.userId, users.id))
    .where(arrayOverlaps(users.roles, sql`array['admin','super_admin']::user_role[]`))
    .orderBy(users.email);
  const report = rows.map((row) => ({
    userId: row.userId,
    email: maskEmail(row.email),
    roles: row.roles,
    status: row.status,
    mfaEnrolled: row.confirmedAt !== null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  }));
  return {
    generatedAt: new Date().toISOString(),
    rows: report,
    missing: report.filter((row) => row.status === 'active' && !row.mfaEnrolled).length,
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = new Set(process.argv.slice(2));
  const handle = createDatabase({
    url: requireEnv('DATABASE_URL'),
    max: 1,
    applicationName: 'vrp-mfa-report',
  });
  try {
    const report = await buildMfaReport(handle.db);
    if (args.has('--json')) {
      console.warn(JSON.stringify(report, null, 2));
    } else {
      console.warn(`Admin MFA report — ${report.generatedAt}`);
      if (report.rows.length === 0) console.warn('No privileged accounts exist.');
      for (const row of report.rows) {
        console.warn(
          `${row.mfaEnrolled ? 'OK  ' : 'MISSING'}  ${row.email.padEnd(28)}  ${row.roles.join(',').padEnd(18)}  ${row.status.padEnd(9)}  ${row.confirmedAt ?? '-'}`,
        );
      }
      console.warn(
        report.missing === 0
          ? 'Every active privileged account has a confirmed authenticator.'
          : `${report.missing} active privileged account(s) lack a confirmed authenticator.`,
      );
    }
    if (args.has('--strict') && report.missing > 0) process.exitCode = 1;
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
