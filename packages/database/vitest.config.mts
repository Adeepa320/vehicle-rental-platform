import { defineConfig } from 'vitest/config';

import { loadRootEnv } from './src/env';

// Make DATABASE_URL_TEST from the repo-root .env available to integration tests.
loadRootEnv();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
