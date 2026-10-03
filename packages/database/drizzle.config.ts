import { defineConfig } from 'drizzle-kit';

import { loadRootEnv } from './src/env';

loadRootEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    // Only needed for `drizzle-kit push/studio`; `generate` works without a database.
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/vehicle_rental',
  },
  strict: true,
  verbose: true,
});
