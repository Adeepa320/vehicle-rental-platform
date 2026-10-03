import fs from 'node:fs';
import path from 'node:path';

/** Absolute path of the repository root (`packages/database/src` -> three levels up). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Loads the repo-root `.env` into `process.env` when it exists. Variables that
 * are already set are never overwritten (same semantics as Node's `--env-file`).
 * Used by CLI scripts (migrate/seed), drizzle-kit and the test runner.
 */
export function loadRootEnv(): void {
  const file = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Returns a required environment variable or throws a readable error. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
}
