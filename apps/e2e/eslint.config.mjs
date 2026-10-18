import { base } from '@vrp/eslint-config/base';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  ...base,
  { ignores: ['playwright-report/**', 'test-results/**', '.world/**'] },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      // The worker wrapper is a plain Node script whose only output channel is the console.
      'no-console': 'off',
    },
  },
]);
