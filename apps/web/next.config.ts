import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for Docker/PaaS deployment (ARCHITECTURE §13).
  output: 'standalone',
  // Required for `standalone` inside a pnpm monorepo so workspace packages are traced.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
