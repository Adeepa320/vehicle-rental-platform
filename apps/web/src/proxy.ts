import { NextResponse, type NextRequest } from 'next/server';

import { apiOrigin, publicEnv } from '@/lib/env';
import { buildContentSecurityPolicy, buildSecurityHeaders, createNonce } from '@/lib/security/csp';

const isProduction = process.env.NODE_ENV === 'production';
const securityHeaders = buildSecurityHeaders({ isProduction });

/**
 * Per-request CSP nonce and security headers (Next 16 `proxy`, formerly
 * middleware). The policy is set on the *request* headers too: Next.js reads
 * the nonce from there and stamps it on its own inline runtime scripts, so
 * every page must render dynamically (the root layout reads `headers()`).
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    apiOrigin,
    imageOrigins: publicEnv.NEXT_PUBLIC_IMAGE_ORIGINS,
    mapOrigins: publicEnv.NEXT_PUBLIC_MAP_ORIGINS,
    isProduction,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    {
      // Documents only: static assets (including the MapLibre worker under /maplibre)
      // and router prefetches carry no inline scripts.
      source: '/((?!_next/static|_next/image|favicon.ico|maplibre/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
