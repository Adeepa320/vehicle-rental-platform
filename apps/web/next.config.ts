import path from 'node:path';

import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * `src/proxy.ts` sets the security headers on document responses. Static
 * assets and the image optimiser are excluded from its matcher (no inline
 * scripts to nonce), so HSTS is repeated here for those paths only — every
 * response from the host then carries it (ASVS 5.0.0 V3.4.1). The value matches
 * `buildSecurityHeaders` in `src/lib/security/csp.ts`.
 */
const STRICT_TRANSPORT_SECURITY = isProduction
  ? 'max-age=31536000; includeSubDomains'
  : 'max-age=31536000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for Docker/PaaS deployment (ARCHITECTURE §13).
  output: 'standalone',
  // Required for `standalone` inside a pnpm monorepo so workspace packages are traced.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // Client bundles import @vrp/contracts from its TypeScript source (the package's
  // `browser` export condition) so unused modules — the legal texts, the common-password
  // list — are tree-shaken (`sideEffects: false`); server code keeps the CommonJS build (O13).
  transpilePackages: ['@vrp/contracts'],
  async headers() {
    const headers = [
      { key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ];
    return [
      { source: '/_next/static/:path*', headers },
      { source: '/_next/image', headers },
      { source: '/favicon.ico', headers },
      { source: '/maplibre/:path*', headers },
    ];
  },
};

export default nextConfig;
