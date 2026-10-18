import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SearchResults } from '@/components/public/search-results';
import { publicPageMetadata } from '@/lib/seo';

// Canonical is the bare /search: filters and dates never reach crawlers' index.
export const metadata: Metadata = publicPageMetadata({
  title: 'Search vehicles',
  description:
    'Find cars, vans, SUVs and bikes to rent on Sri Lanka’s South Coast with real availability, transparent daily prices and platform-approved providers.',
  path: '/search',
});

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <main
          // Reserve the space the results will take so the footer does not jump (Core Web Vitals CLS).
          className="mx-auto min-h-[90vh] w-full max-w-6xl px-4 py-8 text-sm"
          role="status"
        >
          Loading search…
        </main>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
