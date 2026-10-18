import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/seo';

/** Public discovery pages are crawlable; everything behind a session is not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/account',
          '/provider',
          '/bookings',
          '/login',
          '/register',
          '/verify-email',
          '/reset-password',
          '/forgot-password',
          '/notifications',
          '/api',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
