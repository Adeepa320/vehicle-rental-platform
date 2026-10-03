import { z } from 'zod';

const DEFAULT_API_URL = 'http://localhost:4000/api/v1';

/**
 * Browser-visible variables. Next.js inlines `process.env.NEXT_PUBLIC_*` only
 * when referenced literally, hence the explicit property access below.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default(DEFAULT_API_URL),
});

const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url(),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

/** Server-only variables. Call from server components, route handlers or server actions. */
export function serverEnv() {
  return serverEnvSchema.parse({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? publicEnv.NEXT_PUBLIC_API_URL,
  });
}
