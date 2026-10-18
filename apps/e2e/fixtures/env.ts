import fs from 'node:fs';
import path from 'node:path';

/** Directories and URLs shared by the Playwright config and the fixtures. */
export const E2E_DIR = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(E2E_DIR, '..', '..');
export const API_DIR = path.join(REPO_ROOT, 'apps', 'api');
export const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');

export const WEB_URL = 'http://localhost:3000';
export const API_ORIGIN = 'http://localhost:4000';
export const API_URL = `${API_ORIGIN}/api/v1`;
export const MAILPIT_URL = 'http://localhost:8025/api/v1';
/** Health port of the worker wrapper (`scripts/run-worker.mjs`); 4100-4199 are reserved for performance runs. */
export const WORKER_HEALTH_PORT = 4710;

/** Minimal `.env` parser (KEY=value, optional quotes, `#` comments). */
export function parseDotEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    let value = (match[2] ?? '').trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out[match[1] as string] = value;
  }
  return out;
}

/** The repo-root `.env` (database URL, pg-boss schema, SMTP, storage …). */
export function rootEnv(): Record<string, string> {
  const env = parseDotEnv(path.join(REPO_ROOT, '.env'));
  if (!env.DATABASE_URL) {
    throw new Error(
      `DATABASE_URL is not set in ${path.join(REPO_ROOT, '.env')}; copy .env.example to .env first`,
    );
  }
  return env;
}

/**
 * Environment of the API process under test. Development mode (the fake payment
 * gateway is refused in production), admin MFA on, and per-IP limits raised:
 * one machine registers a dozen accounts and fires hundreds of requests in a
 * few minutes. Access tokens last an hour so tokens minted during the setup
 * project stay valid for the whole run (the default 15 minutes is too short).
 */
export const API_ENV_OVERRIDES: Record<string, string> = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  PAYMENT_GATEWAY: 'fake',
  ADMIN_MFA_REQUIRED: 'true',
  AUTH_SENSITIVE_LIMIT_PER_15MIN: '200',
  AUTH_LOGIN_LIMIT_PER_MINUTE: '500',
  RATE_LIMIT_MAX: '5000',
  WEB_APP_URL: WEB_URL,
  CORS_ORIGINS: WEB_URL,
  API_PUBLIC_URL: API_URL,
  API_PORT: '4000',
  ACCESS_TOKEN_TTL_SECONDS: '3600',
};

export function apiEnv(): Record<string, string> {
  return { ...rootEnv(), ...API_ENV_OVERRIDES };
}

export function workerEnv(): Record<string, string> {
  return {
    ...apiEnv(),
    E2E_API_DIR: API_DIR,
    E2E_WORKER_HEALTH_PORT: String(WORKER_HEALTH_PORT),
  };
}

/** `next start` serves the production build; it needs the API URLs and nothing from the API's secrets. */
export function webEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    NEXT_PUBLIC_API_URL: API_URL,
    API_INTERNAL_URL: API_URL,
    NEXT_PUBLIC_WEB_URL: WEB_URL,
    PORT: '3000',
  };
}
