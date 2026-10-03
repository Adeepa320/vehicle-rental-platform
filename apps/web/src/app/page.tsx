import type { PlaceSummary } from '@vrp/contracts';
import Link from 'next/link';

import { SearchForm } from '@/components/public/search-form';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createApiClient } from '@/lib/api-client';
import { serverEnv } from '@/lib/env';
import { searchHref } from '@/lib/search-params';

// Quick picks come from the live gazetteer; never a stale render.
export const dynamic = 'force-dynamic';

const VALUE_PROPS = [
  {
    title: 'Real availability',
    body: 'Search with your dates and see only vehicles that are actually free. Providers keep their calendars up to date on the platform.',
  },
  {
    title: 'Transparent prices',
    body: 'Daily rate, deposit, included kilometres and extra-km charges are shown up front, in rupees, before you contact anyone.',
  },
  {
    title: 'Platform-approved providers',
    body: 'Every provider is reviewed by our team before listing. Exact pickup addresses are shared once a booking is confirmed.',
  },
];

export default async function HomePage() {
  const env = serverEnv();
  const api = createApiClient({ baseUrl: env.API_INTERNAL_URL, timeoutMs: 3_000 });
  let launchPlaces: PlaceSummary[] = [];
  try {
    launchPlaces = (await api.reference.places()).filter((p) => p.isLaunchArea).slice(0, 8);
  } catch {
    // The search box still works; quick picks are a convenience.
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12">
      <section className="space-y-6">
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm font-medium">Sri Lanka · South Coast</p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Rent a car, van, SUV or bike from approved local providers
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Compare real vehicles in Matara, Weligama, Mirissa, Galle and Unawatuna with honest
            daily prices and live availability. Browse today; booking requests open in the next
            release.
          </p>
        </div>
        <SearchForm />
        {launchPlaces.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Popular:</span>
            {launchPlaces.map((place) => (
              <Button
                key={place.id}
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={searchHref({ placeId: place.id, sort: 'relevance' })} />}
              >
                {place.name}
              </Button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <CardTitle className="text-base">{item.title}</CardTitle>
              <CardDescription>{item.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-6">
        <div>
          <h2 className="text-lg font-semibold">Do you rent out vehicles?</h2>
          <p className="text-muted-foreground text-sm">
            List for free. Our team reviews every provider and every listing before it goes live.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/become-a-provider" />}>
          Become a provider
        </Button>
      </section>
    </main>
  );
}
