import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, buildSecurityHeaders, createNonce } from './csp';

const base = {
  nonce: 'abc123',
  apiOrigin: 'https://api.example.lk',
  imageOrigins: ['https://photos.example.lk'],
  mapOrigins: ['https://tiles.openfreemap.org'],
};

const directivesOf = (csp: string): Map<string, string[]> =>
  new Map(
    csp.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name ?? '', sources];
    }),
  );

describe('buildContentSecurityPolicy', () => {
  it('produces the production policy', () => {
    expect(buildContentSecurityPolicy({ ...base, isProduction: true })).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://photos.example.lk",
        "connect-src 'self' https://api.example.lk https://tiles.openfreemap.org",
        "worker-src 'self' blob:",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self' https://api.example.lk https://www.payhere.lk https://sandbox.payhere.lk",
        "frame-src 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    );
  });

  it('allows eval only outside production and never upgrades local requests', () => {
    const dev = directivesOf(
      buildContentSecurityPolicy({
        ...base,
        apiOrigin: 'http://localhost:4000',
        imageOrigins: ['http://localhost:9000'],
        isProduction: false,
      }),
    );
    expect(dev.get('script-src')).toEqual([
      "'self'",
      "'nonce-abc123'",
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    expect(dev.has('upgrade-insecure-requests')).toBe(false);
    expect(dev.get('form-action')).toContain('http://localhost:4000');
    expect(dev.get('img-src')).toContain('http://localhost:9000');
  });

  it('keeps the payment hand-off and the fake gateway allowed by form-action', () => {
    const csp = directivesOf(buildContentSecurityPolicy({ ...base, isProduction: true }));
    expect(csp.get('form-action')).toEqual([
      "'self'",
      'https://api.example.lk',
      'https://www.payhere.lk',
      'https://sandbox.payhere.lk',
    ]);
  });

  it('de-duplicates origins and never emits inline-script allowances', () => {
    const csp = buildContentSecurityPolicy({
      ...base,
      imageOrigins: ['https://a.example', 'https://a.example'],
      mapOrigins: ['https://api.example.lk', 'https://tiles.example'],
      isProduction: true,
    });
    const directives = directivesOf(csp);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https://a.example']);
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'https://api.example.lk',
      'https://tiles.example',
    ]);
    expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
    expect(directives.get('frame-src')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
  });

  it('uses the nonce Next.js can parse from script-src', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(createNonce()).not.toBe(nonce);
    const csp = buildContentSecurityPolicy({ ...base, nonce, isProduction: true });
    expect(csp).toContain(`'nonce-${nonce}'`);
  });
});

describe('buildSecurityHeaders', () => {
  it('sets the fixed headers and scopes HSTS subdomains to production', () => {
    const prod = buildSecurityHeaders({ isProduction: true });
    expect(prod).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
    expect(buildSecurityHeaders({ isProduction: false })['Strict-Transport-Security']).toBe(
      'max-age=31536000',
    );
  });
});
