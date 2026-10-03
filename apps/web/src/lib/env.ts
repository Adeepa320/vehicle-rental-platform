import { z } from 'zod';

const DEFAULT_API_URL = 'http://localhost:4000/api/v1';

/**
 * Browser-visible variables. Next.js inlines `process.env.NEXT_PUBLIC_*` only
 * when referenced literally, hence the explicit property access below.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default(DEFAULT_API_URL),
  /** MapLibre style JSON. Defaults to OpenFreeMap (free, no key); any style URL works (TECH_DECISIONS D46). */
  NEXT_PUBLIC_MAP_STYLE_URL: z.url().default('https://tiles.openfreemap.org/styles/liberty'),
});

const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url(),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
});

/** Server-only variables. Call from server components, route handlers or server actions. */
export function serverEnv() {
  return serverEnvSchema.parse({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? publicEnv.NEXT_PUBLIC_API_URL,
  });
}
