import type { Metadata } from 'next';

import { publicEnv } from '@/lib/env';

export const SITE_NAME = 'Vehicle Rental Platform';
export const SITE_DESCRIPTION =
  'Search nearby vehicles, see real availability, compare transparent prices and book from platform-approved providers on Sri Lanka’s South Coast.';

/** Canonical site origin (no trailing slash). */
export const siteUrl = publicEnv.NEXT_PUBLIC_WEB_URL.replace(/\/+$/, '');

/** Signed-in and account areas are never indexed. */
export const noIndexMetadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Metadata for a crawlable page. `path` is the canonical application path;
 * `metadataBase` in the root layout turns it into an absolute URL. Never pass
 * exact locations or availability into these fields (SECURITY_AND_PRIVACY §13).
 */
export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description,
      url: path,
      locale: 'en_LK',
    },
  };
}
