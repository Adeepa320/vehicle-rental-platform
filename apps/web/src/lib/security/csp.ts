/**
 * Content Security Policy and companion security headers (Phase 10,
 * SECURITY_AND_PRIVACY §"Web application"). Pure functions so the exact
 * header strings are unit-tested; `src/proxy.ts` applies them per request.
 *
 * Remaining limitation: `style-src` keeps `'unsafe-inline'`. A nonce-only
 * policy was evaluated and rejected because nonces cannot cover `style`
 * attributes, which the server-rendered markup relies on (next/image `fill`
 * positioning, Base UI's visually-hidden inputs) and which MapLibre sets on
 * its markers and controls. Scripts are nonce + `'strict-dynamic'`, which is
 * where the XSS protection lies.
 */

export interface ContentSecurityPolicyInput {
  /** Per-request random value (see `createNonce`). */
  nonce: string;
  /** `scheme://host[:port]` of the public API. */
  apiOrigin: string;
  /** Origins that serve listing photos. */
  imageOrigins: readonly string[];
  /** Origins the map fetches styles, tiles, sprites and glyphs from. */
  mapOrigins: readonly string[];
  isProduction: boolean;
}

/** PayHere hosted checkout (live and sandbox); the booking payment form posts there. */
export const PAYMENT_FORM_ACTIONS = [
  'https://www.payhere.lk',
  'https://sandbox.payhere.lk',
] as const;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** Builds the `Content-Security-Policy` header value. */
export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  const { nonce, apiOrigin, imageOrigins, mapOrigins, isProduction } = input;
  const directives: string[][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React's dev tooling reconstructs stacks with eval; never in production.
      ...(isProduction ? [] : ["'unsafe-eval'"]),
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', ...unique(imageOrigins)],
    ['connect-src', "'self'", ...unique([apiOrigin, ...mapOrigins])],
    // MapLibre runs its tile workers from blob: URLs.
    ['worker-src', "'self'", 'blob:'],
    ['font-src', "'self'"],
    ['frame-ancestors', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'", apiOrigin, ...PAYMENT_FORM_ACTIONS],
    ['frame-src', "'none'"],
    ...(isProduction ? [['upgrade-insecure-requests']] : []),
  ];
  return directives.map((parts) => parts.join(' ')).join('; ');
}

/** Companion headers set on every HTML response. */
export function buildSecurityHeaders({
  isProduction,
}: {
  isProduction: boolean;
}): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Browsers only honour HSTS over HTTPS, so the header is harmless locally.
    'Strict-Transport-Security': isProduction
      ? 'max-age=31536000; includeSubDomains'
      : 'max-age=31536000',
  };
}

/** 128 random bits, base64 (the character set CSP nonces accept). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
