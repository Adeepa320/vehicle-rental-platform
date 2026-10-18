import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_IDS, SEARCH_PAGE_MAX } from '@vrp/contracts';
import type { MetadataRoute } from 'next';

import { createApiClient } from '@/lib/api-client';
import { serverEnv } from '@/lib/env';
import { LEGAL_ROUTES, isLegalPageVisible } from '@/lib/legal-pages';
import { siteUrl } from '@/lib/seo';

/** At most this many search pages (× `SEARCH_PAGE_MAX` listings) are walked per generation. */
const MAX_SEARCH_PAGES = 20;

// Regenerated at most hourly; the build-time render falls back to the static entries.
export const revalidate = 3600;

/**
 * The API client sends `cache: 'no-store'`, which would make this route
 * re-walk the catalogue on every crawler hit; here the search pages go
 * through Next's data cache for the same hour instead.
 */
const cachedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: undefined, next: { revalidate } });

/**
 * Static public pages plus every searchable listing. If the API is unreachable
 * (during `next build`, or an outage) the static entries are returned and the
 * sitemap never fails.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/search`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${siteUrl}/become-a-provider`, changeFrequency: 'monthly', priority: 0.5 },
    ...LEGAL_DOCUMENT_IDS.map((id) => LEGAL_DOCUMENTS[id])
      .filter(isLegalPageVisible)
      .map((doc) => ({
        url: `${siteUrl}${LEGAL_ROUTES[doc.id]}`,
        lastModified: doc.lastUpdated,
        changeFrequency: 'yearly' as const,
        priority: 0.3,
      })),
  ];

  try {
    const api = createApiClient({
      baseUrl: serverEnv().API_INTERNAL_URL,
      timeoutMs: 5_000,
      fetchImpl: cachedFetch,
    });
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const result = await api.public.search({ limit: SEARCH_PAGE_MAX, cursor });
      for (const card of result.data) {
        if (seen.has(card.slug)) continue;
        seen.add(card.slug);
        entries.push({
          url: `${siteUrl}/vehicles/${encodeURIComponent(card.slug)}`,
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
  } catch {
    // Static entries only: the API is down or not reachable from the build environment.
  }

  return entries;
}
