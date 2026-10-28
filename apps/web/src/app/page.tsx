import type { District, PlaceSummary, VehicleCategory } from '@vrp/contracts';
import {
  ArrowRight,
  Bike,
  Bus,
  CalendarCheck,
  Car,
  CarFront,
  MapPin,
  ReceiptText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { SearchForm } from '@/components/public/search-form';
import { Button } from '@/components/ui/button';
import { createApiClient } from '@/lib/api-client';
import { serverEnv } from '@/lib/env';
import { searchHref } from '@/lib/search-params';
import { SITE_DESCRIPTION, SITE_NAME, publicPageMetadata } from '@/lib/seo';

// Quick picks come from the live gazetteer; never a stale render.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  ...publicPageMetadata({
    title: `${SITE_NAME} – rent cars, vans, SUVs and bikes on Sri Lanka’s South Coast`,
    description: SITE_DESCRIPTION,
    path: '/',
  }),
  // The home page carries the site name itself; skip the "· Vehicle Rental Platform" template.
  title: { absolute: `${SITE_NAME} – rent cars, vans, SUVs and bikes on Sri Lanka’s South Coast` },
};

const VALUE_PROPS: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: 'Real availability',
    body: 'Search with your dates and see only vehicles that are actually free. Providers keep their calendars up to date on the platform.',
    icon: CalendarCheck,
  },
  {
    title: 'Transparent prices',
    body: 'Daily rate, deposit, included kilometres and extra-km charges are shown up front, in rupees, before you contact anyone.',
    icon: ReceiptText,
  },
  {
    title: 'Platform-approved providers',
    body: 'Every provider is reviewed by our team before listing. Exact pickup addresses are shared once a booking is confirmed.',
    icon: ShieldCheck,
  },
];

/** Icons for the seeded category ids; anything else falls back to a car. */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  car: Car,
  suv: CarFront,
  van: Bus,
  bike: Bike,
};

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    // The search box still works; shortcuts are a convenience.
    return fallback;
  }
}

export default async function HomePage() {
  const env = serverEnv();
  const api = createApiClient({ baseUrl: env.API_INTERNAL_URL, timeoutMs: 3_000 });
  const [places, categories, districts] = await Promise.all([
    settled<PlaceSummary[]>(api.reference.places(), []),
    settled<VehicleCategory[]>(api.reference.vehicleCategories(), []),
    settled<District[]>(api.reference.districts(), []),
  ]);
  const launchPlaces = places.filter((p) => p.isLaunchArea).slice(0, 8);
  const districtName = (id: string) => districts.find((d) => d.id === id)?.name ?? null;

  return (
    <main className="flex w-full flex-col">
      <section className="bg-brand text-brand-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-12 pb-14 sm:pt-16 sm:pb-20">
          <div className="max-w-3xl space-y-4">
            <p className="text-cta text-sm font-semibold tracking-wide uppercase">
              Sri Lanka · South Coast
            </p>
            <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-5xl">
              Rent a car, van, SUV or bike from approved local providers
            </h1>
            <p className="max-w-2xl text-base text-white/85 sm:text-lg">
              Compare real vehicles in Matara, Weligama, Mirissa, Galle and Unawatuna with honest
              daily prices and live availability.
            </p>
          </div>
          <SearchForm />
          {launchPlaces.length > 0 ? (
            <nav aria-label="Popular towns" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/80">Popular:</span>
              {launchPlaces.map((place) => (
                <Link
                  key={place.id}
                  href={searchHref({ placeId: place.id, sort: 'relevance' })}
                  className="rounded-full border border-white/25 px-3 py-1 text-white transition-colors hover:border-white/60 hover:bg-white/10"
                >
                  {place.name}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-14">
        {launchPlaces.length > 0 ? (
          <section aria-labelledby="areas-heading" className="space-y-5">
            <SectionHeading
              id="areas-heading"
              title="Popular South Coast areas"
              subtitle="Pick a town to see vehicles available nearby."
            />
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {launchPlaces.map((place) => (
                <li key={place.id}>
                  <Link
                    href={searchHref({ placeId: place.id, sort: 'relevance' })}
                    className="group bg-card hover:border-teal flex items-center gap-3 rounded-xl border p-4 shadow-xs transition-colors"
                  >
                    <span className="bg-teal-soft text-teal-strong flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <MapPin className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block font-semibold">{place.name}</span>
                      <span className="text-muted-foreground block text-sm">
                        {districtName(place.districtId)
                          ? `${districtName(place.districtId)} district`
                          : 'South Coast'}
                      </span>
                    </span>
                    <ArrowRight
                      className="text-muted-foreground group-hover:text-teal size-4 shrink-0 transition-colors"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {categories.length > 0 ? (
          <section aria-labelledby="types-heading" className="space-y-5">
            <SectionHeading
              id="types-heading"
              title="Browse by vehicle type"
              subtitle="Every listing is reviewed by our team before it goes live."
            />
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {categories.map((category) => {
                const Icon = CATEGORY_ICON[category.id] ?? Car;
                return (
                  <li key={category.id}>
                    <Link
                      href={searchHref({ categoryId: category.id, sort: 'relevance' })}
                      className="bg-card hover:border-teal flex flex-col items-start gap-3 rounded-xl border p-5 shadow-xs transition-colors"
                    >
                      <Icon className="text-brand size-7" aria-hidden />
                      <span className="text-foreground font-semibold">{category.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="why-heading" className="space-y-5">
          <SectionHeading id="why-heading" title="Why book with us" />
          <ul className="grid gap-4 sm:grid-cols-3">
            {VALUE_PROPS.map((item) => (
              <li key={item.title} className="bg-card rounded-xl border p-5 shadow-xs">
                <item.icon className="text-teal mb-3 size-6" aria-hidden />
                <h3 className="text-foreground font-semibold">{item.title}</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-card flex flex-col gap-4 rounded-2xl border p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="space-y-1">
            <h2 className="text-brand text-xl font-bold">Do you rent out vehicles?</h2>
            <p className="text-muted-foreground text-sm">
              List for free. Our team reviews every provider and every listing before it goes live.
            </p>
          </div>
          <Button size="xl" nativeButton={false} render={<Link href="/become-a-provider" />}>
            Become a provider
          </Button>
        </section>
      </div>
    </main>
  );
}

function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-brand text-2xl font-bold tracking-tight">
        {title}
      </h2>
      {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
