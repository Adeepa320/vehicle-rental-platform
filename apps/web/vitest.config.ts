import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Unit tests for pure web logic (form conversion, API client). Pages are
// verified by `next build` and the smoke test, not by component tests yet.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
