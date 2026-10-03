import { defineConfig } from 'eslint/config';
import { base } from './base.js';

/**
 * NestJS config. `consistent-type-imports` is disabled because NestJS dependency
 * injection relies on `emitDecoratorMetadata`, which needs value imports of the
 * injected classes; type-only imports would erase them and break DI at runtime.
 */
export default defineConfig([
  ...base,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]);
