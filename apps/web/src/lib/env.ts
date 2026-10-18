import { z } from 'zod';

const DEFAULT_API_URL = 'http://localhost:4000/api/v1';
const DEFAULT_WEB_URL = 'http://localhost:3000';
const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
/** Local MinIO (vehicle photo variants) and the free OpenFreeMap tiles (TECH_DECISIONS D46). */
const DEFAULT_IMAGE_ORIGINS = 'http://localhost:9000';
const DEFAULT_MAP_ORIGINS = 'https://tiles.openfreemap.org';

/** Comma-separated list of URLs → unique origins (`scheme://host[:port]`); blanks are ignored. */
export function parseOriginList(value: string | undefined, fallback: string): string[] {
  const raw = value === undefined || value.trim() === '' ? fallback : value;
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => new URL(z.url().parse(entry)).origin);
  return [...new Set(origins)];
}

/**
 * Browser-visible variables. Next.js inlines `process.env.NEXT_PUBLIC_*` only
 * when referenced literally, hence the explicit property access below.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default(DEFAULT_API_URL),
  /** Canonical site URL (metadata, sitemap, robots). */
  NEXT_PUBLIC_WEB_URL: z.url().default(DEFAULT_WEB_URL),
  /** MapLibre style JSON. Defaults to OpenFreeMap (free, no key); any style URL works (TECH_DECISIONS D46). */
  NEXT_PUBLIC_MAP_STYLE_URL: z.url().default(DEFAULT_MAP_STYLE_URL),
  /** Origins allowed to serve images (photo storage); comma-separated in the environment. */
  NEXT_PUBLIC_IMAGE_ORIGINS: z.array(z.url()).min(1),
  /** Origins the map may fetch styles, tiles, sprites and glyphs from. */
  NEXT_PUBLIC_MAP_ORIGINS: z.array(z.url()).min(1),
});

const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url(),
});

const mapStyleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? DEFAULT_MAP_STYLE_URL;

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
  NEXT_PUBLIC_MAP_STYLE_URL: mapStyleUrl,
  NEXT_PUBLIC_IMAGE_ORIGINS: parseOriginList(
    process.env.NEXT_PUBLIC_IMAGE_ORIGINS,
    DEFAULT_IMAGE_ORIGINS,
  ),
  // The style's own origin is always allowed, so changing only the style URL never breaks the map.
  NEXT_PUBLIC_MAP_ORIGINS: parseOriginList(
    [process.env.NEXT_PUBLIC_MAP_ORIGINS ?? DEFAULT_MAP_ORIGINS, mapStyleUrl].join(','),
    DEFAULT_MAP_ORIGINS,
  ),
});

/** `scheme://host[:port]` of the public API (for CSP `connect-src` / `form-action`). */
export const apiOrigin = new URL(publicEnv.NEXT_PUBLIC_API_URL).origin;

/** Server-only variables. Call from server components, route handlers or server actions. */
export function serverEnv() {
  return serverEnvSchema.parse({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL ?? publicEnv.NEXT_PUBLIC_API_URL,
  });
}
