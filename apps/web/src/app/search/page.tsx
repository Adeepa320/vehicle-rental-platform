import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SearchResults } from '@/components/public/search-results';

export const metadata: Metadata = {
  title: 'Search vehicles',
  description:
    'Find cars, vans, SUVs and bikes to rent on Sri Lanka’s South Coast with real availability, transparent daily prices and platform-approved providers.',
};

export default function SearchPage() {
  return (
    <Suspense
      fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm">Loading search…</main>}
    >
      <SearchResults />
    </Suspense>
  );
}
