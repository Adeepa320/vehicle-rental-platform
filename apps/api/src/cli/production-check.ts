/**
 * Production readiness validator (Phase 10, docs/DEPLOYMENT.md). Validates a
 * production configuration WITHOUT printing a single value and WITHOUT calling
 * destructive or paid APIs:
 *
 *   pnpm production:check --env-file .env.production [--web-env-file apps/web/.env.production] [--live] [--json]
 *
 * - config checks: the API environment schema in production mode plus
 *   go-live rules that are warnings rather than start-up failures;
 * - web checks (optional file): public URLs, origins, legal pages approved;
 * - `--live`: read-only connectivity — database `select 1` and applied
 *   migrations, both object-storage buckets (HeadBucket), SMTP `verify()`,
 *   and the admin MFA report (every active privileged account enrolled).
 *
 * Exit code 1 when any check FAILS. Local and test environments are not the
 * target: run it against the file you are about to deploy.
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { LEGAL_DOCUMENTS, isLegalDocumentPublishable, legalMarkersRemaining } from '@vrp/contracts';
import { createDatabase } from '@vrp/database';
import { sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';

import { derived, envSchema, isLocalOrInsecureUrl, type Env } from '../config/env.schema';
import { buildMfaReport } from './mfa-report';

type Level = 'PASS' | 'FAIL' | 'WARN';
interface Check {
  level: Level;
  area: 'config' | 'web' | 'legal' | 'live';
  name: string;
  message: string;
}

interface Options {
  envFile?: string;
  webEnvFile?: string;
  live: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { live: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env-file') options.envFile = argv[++i];
    else if (arg === '--web-env-file') options.webEnvFile = argv[++i];
    else if (arg === '--live') options.live = true;
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return options;
}

function loadValues(file: string | undefined): Record<string, string> {
  if (!file) {
    return Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  }
  return parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
}

const WEB_PUBLIC_URL_VARS = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_WEB_URL'] as const;
const WEB_ORIGIN_LIST_VARS = ['NEXT_PUBLIC_IMAGE_ORIGINS', 'NEXT_PUBLIC_MAP_ORIGINS'] as const;
const WEB_CONTACT_VARS = [
  'NEXT_PUBLIC_SUPPORT_EMAIL',
  'NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL',
] as const;

export function configChecks(raw: Record<string, string>): { checks: Check[]; env: Env | null } {
  const checks: Check[] = [];
  const values = { ...raw, NODE_ENV: raw.NODE_ENV ?? 'production' };
  if (values.NODE_ENV !== 'production') {
    checks.push({
      level: 'FAIL',
      area: 'config',
      name: 'NODE_ENV',
      message: `is "${values.NODE_ENV}"; a production deployment must set production`,
    });
    values.NODE_ENV = 'production';
  }
  const parsed = envSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      checks.push({
        level: 'FAIL',
        area: 'config',
        name: issue.path.join('.') || '(root)',
        message: issue.message,
      });
    }
    return { checks, env: null };
  }
  const env = parsed.data;
  checks.push({
    level: 'PASS',
    area: 'config',
    name: 'env schema',
    message: 'production rules satisfied',
  });
  if (env.TRUST_PROXY_HOPS === 0) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'TRUST_PROXY_HOPS',
      message:
        'is 0: behind Railway (1 hop) or Cloudflare + Railway (2 hops) client IPs will be the proxy address',
    });
  }
  if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace') {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'LOG_LEVEL',
      message: `${env.LOG_LEVEL} is noisy for production; use info`,
    });
  }
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL)) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'DATABASE_URL',
      message: 'points at localhost',
    });
  }
  if (!/sslmode=require|ssl=true/.test(env.DATABASE_URL)) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'DATABASE_URL',
      message: 'does not request TLS (sslmode=require); managed providers usually need it',
    });
  }
  if (!env.SENTRY_DSN) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'SENTRY_DSN',
      message: 'not set: error tracking is off',
    });
  }
  if (!env.APP_RELEASE) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'APP_RELEASE',
      message: 'not set: logs and errors carry no release identifier',
    });
  }
  if (!env.OPERATOR_NOTIFICATION_EMAIL) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'OPERATOR_NOTIFICATION_EMAIL',
      message: 'not set: no operator notices for applications, disputes or privacy requests',
    });
  }
  if (env.LAUNCH_MODE !== 'production') {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'LAUNCH_MODE',
      message: 'staging: the PayHere sandbox is allowed; set production for the live launch',
    });
  }
  if (!env.PAYHERE_APP_ID || !env.PAYHERE_APP_SECRET) {
    checks.push({
      level: 'WARN',
      area: 'config',
      name: 'PAYHERE_APP_ID',
      message:
        'Merchant API credentials absent: gateway refunds and reconciliation answer 503 (manual refunds only)',
    });
  }
  if (!derived.adminMfaRequired(env)) {
    checks.push({
      level: 'FAIL',
      area: 'config',
      name: 'ADMIN_MFA_REQUIRED',
      message: 'admin MFA policy is off',
    });
  } else {
    checks.push({
      level: 'PASS',
      area: 'config',
      name: 'ADMIN_MFA_REQUIRED',
      message: 'privileged routes require a verified factor',
    });
  }
  return { checks, env };
}

export function webChecks(raw: Record<string, string>): Check[] {
  const checks: Check[] = [];
  for (const name of WEB_PUBLIC_URL_VARS) {
    const value = raw[name];
    if (!value) checks.push({ level: 'FAIL', area: 'web', name, message: 'is required' });
    else if (isLocalOrInsecureUrl(value))
      checks.push({ level: 'FAIL', area: 'web', name, message: 'must be a public https:// URL' });
    else checks.push({ level: 'PASS', area: 'web', name, message: 'public https URL' });
  }
  for (const name of WEB_ORIGIN_LIST_VARS) {
    const value = raw[name];
    if (!value) {
      checks.push({
        level: 'FAIL',
        area: 'web',
        name,
        message: 'is required (comma-separated https origins for the CSP)',
      });
      continue;
    }
    const bad = value
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o && isLocalOrInsecureUrl(o));
    checks.push(
      bad.length > 0
        ? {
            level: 'FAIL',
            area: 'web',
            name,
            message: `${bad.length} origin(s) are local or not https`,
          }
        : { level: 'PASS', area: 'web', name, message: 'https origins only' },
    );
  }
  for (const name of WEB_CONTACT_VARS) {
    checks.push(
      raw[name] && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw[name] as string)
        ? { level: 'PASS', area: 'web', name, message: 'set' }
        : {
            level: 'FAIL',
            area: 'web',
            name,
            message: 'the public site needs a support / privacy contact address',
          },
    );
  }
  if (!raw.API_INTERNAL_URL) {
    checks.push({
      level: 'WARN',
      area: 'web',
      name: 'API_INTERNAL_URL',
      message: 'not set: server rendering uses the public API URL',
    });
  }
  return checks;
}

export function legalChecks(): Check[] {
  return Object.values(LEGAL_DOCUMENTS).map((doc) =>
    isLegalDocumentPublishable(doc)
      ? {
          level: 'PASS' as const,
          area: 'legal' as const,
          name: doc.id,
          message: `approved (${doc.version})`,
        }
      : {
          level: 'FAIL' as const,
          area: 'legal' as const,
          name: doc.id,
          message: `${doc.status}; open markers: ${legalMarkersRemaining(doc).join(', ') || 'none'} — public legal pages stay withheld`,
        },
  );
}

async function liveChecks(env: Env): Promise<Check[]> {
  const checks: Check[] = [];
  // ---- database
  const handle = createDatabase({
    url: env.DATABASE_URL,
    max: 1,
    applicationName: 'vrp-production-check',
  });
  try {
    await handle.db.execute(sql`select 1`);
    const [row] = await handle.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    checks.push({
      level: 'PASS',
      area: 'live',
      name: 'database',
      message: `reachable; ${row?.count ?? 0} migrations applied`,
    });
    const report = await buildMfaReport(handle.db);
    checks.push(
      report.missing === 0
        ? {
            level: 'PASS',
            area: 'live',
            name: 'admin MFA',
            message: `${report.rows.length} privileged account(s), all enrolled`,
          }
        : {
            level: 'FAIL',
            area: 'live',
            name: 'admin MFA',
            message: `${report.missing} active privileged account(s) without a confirmed authenticator`,
          },
    );
  } catch (error) {
    checks.push({ level: 'FAIL', area: 'live', name: 'database', message: describe(error) });
  } finally {
    await handle.close().catch(() => undefined);
  }
  // ---- object storage (HeadBucket only)
  const s3 = new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
  });
  for (const bucket of [env.STORAGE_BUCKET_PRIVATE, env.STORAGE_BUCKET_PUBLIC]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      checks.push({
        level: 'PASS',
        area: 'live',
        name: `bucket ${bucket}`,
        message: 'exists and credentials can read it',
      });
    } catch (error) {
      checks.push({
        level: 'FAIL',
        area: 'live',
        name: `bucket ${bucket}`,
        message: describe(error),
      });
    }
  }
  s3.destroy();
  // ---- SMTP (connection + auth handshake, no message sent)
  try {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: derived.smtpRequireTls(env),
      auth:
        env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
    });
    await transport.verify();
    transport.close();
    checks.push({
      level: 'PASS',
      area: 'live',
      name: 'smtp',
      message: 'connection and authentication verified',
    });
  } catch (error) {
    checks.push({ level: 'FAIL', area: 'live', name: 'smtp', message: describe(error) });
  }
  return checks;
}

/** Error text without connection strings, hosts with credentials or key material. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(ql)?:\/\/\S+/g, 'postgresql://***').slice(0, 200);
}

export async function runProductionCheck(
  options: Options,
): Promise<{ checks: Check[]; failed: number }> {
  const checks: Check[] = [];
  const raw = loadValues(options.envFile);
  const { checks: config, env } = configChecks(raw);
  checks.push(...config);
  if (options.webEnvFile) checks.push(...webChecks(loadValues(options.webEnvFile)));
  checks.push(...legalChecks());
  if (options.live) {
    if (env) checks.push(...(await liveChecks(env)));
    else
      checks.push({
        level: 'FAIL',
        area: 'live',
        name: 'skipped',
        message: 'fix the configuration first',
      });
  }
  return { checks, failed: checks.filter((c) => c.level === 'FAIL').length };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { checks, failed } = await runProductionCheck(options);
  if (options.json) {
    console.warn(JSON.stringify({ checkedAt: new Date().toISOString(), failed, checks }, null, 2));
  } else {
    for (const check of checks) {
      console.warn(
        `${check.level.padEnd(4)}  ${check.area.padEnd(6)}  ${check.name}: ${check.message}`,
      );
    }
    console.warn(
      failed === 0
        ? `\nREADY: ${checks.length} checks, no failures (warnings are advisory).`
        : `\nNOT READY: ${failed} failing check(s).`,
    );
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
