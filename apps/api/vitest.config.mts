import fs from 'node:fs';
import path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Make DATABASE_URL_TEST from the repo-root .env available to e2e tests without
// overriding variables that are already set (same semantics as --env-file).
const rootEnv = path.resolve(import.meta.dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) {
  const before = { ...process.env };
  process.loadEnvFile(rootEnv);
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // e2e files share the test database; keep them sequential.
    fileParallelism: false,
  },
  plugins: [
    // NestJS relies on decorator metadata, which esbuild (Vitest's default) cannot emit.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
