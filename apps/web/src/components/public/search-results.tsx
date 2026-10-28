'use client';

import type { PublicVehicleCard, SearchCriteria } from '@vrp/contracts';
import { Map as MapIcon, SearchX, SlidersHorizontal } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';
import { useReferenceData } from '@/lib/reference';
import {
  parseSearchParams,
  searchHref,
  toApiQuery,
  vehicleHref,
  type SearchState,
} from '@/lib/search-params';
import { FUEL_LABEL, TRANSMISSION_LABEL, formatDay } from '@/lib/vehicle-labels';

import { SearchForm } from './search-form';
import type { MapPoint } from './search-map';
import { VehicleCard } from './vehicle-card';

const SearchMap = dynamic(() => import('./search-map').then((m) => m.SearchMap), {
  ssr: false,
  loading: () => <div className="bg-muted h-80 w-full animate-pulse rounded-md" />,
});

const selectClass =
  'border-input bg-card h-9 w-full rounded-lg border px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-[3px]';
const filterLabelClass = 'text-foreground text-sm font-medium';

type Status = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

export function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const { api } = useAuth();
  const reference = useReferenceData();
  const state = useMemo(() => parseSearchParams(params), [params]);
  const [cards, setCards] = useState<PublicVehicleCard[]>([]);
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [showMap, setShowMap] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setStatus({ kind: 'loading' });
      try {
        const page = await api.public.search(toApiQuery(state, { cursor, limit: 20 }));
        setCards((current) => (cursor ? [...current, ...page.data] : page.data));
        setCriteria(page.criteria);
        setNextCursor(page.nextCursor);
        setStatus({ kind: 'ready' });
      } catch (error) {
        setStatus({ kind: 'error', message: submitErrorFrom(error).message });
      }
    },
    [api, state],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const update = (patch: Partial<SearchState>) => router.push(searchHref({ ...state, ...patch }));
  const ref = reference.status === 'ready' ? reference.data : undefined;
  const points: MapPoint[] = cards
    .filter((c) => c.approxPoint)
    .map((c) => ({
      id: c.id,
      lat: c.approxPoint!.lat,
      lng: c.approxPoint!.lng,
      title: c.title,
      subtitle: `${c.place.name} · from LKR ${c.pricing.dailyRate}/day`,
      href: vehicleHref(c.slug, state),
    }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <SearchForm initial={state} compact />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-brand text-2xl font-bold tracking-tight sm:text-3xl">
            {criteria?.place
              ? `Vehicles near ${criteria.place.name}`
              : state.districtId
                ? `Vehicles in ${state.districtId}`
                : 'Vehicles on the South Coast'}
          </h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
            {status.kind === 'ready' ? (
              <span className="text-foreground font-semibold">
                {cards.length}
                {nextCursor ? '+' : ''} vehicle{cards.length === 1 ? '' : 's'}
              </span>
            ) : null}
            <span>
              {criteria?.startsAt && criteria.endsAt
                ? `${formatDay(criteria.startsAt)} → ${formatDay(criteria.endsAt)} · ${criteria.days} day${criteria.days === 1 ? '' : 's'} · only vehicles free for the whole window`
                : 'Add dates to see real availability and an estimated total.'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground text-sm" htmlFor="sort">
            Sort
          </label>
          <select
            id="sort"
            className={selectClass}
            value={state.sort}
            onChange={(e) => update({ sort: e.target.value as SearchState['sort'] })}
          >
            <option value="relevance">Recommended</option>
            {state.placeId ? <option value="distance">Distance</option> : null}
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
          <Button
            variant="outline"
            className="h-9 bg-card"
            aria-pressed={showMap}
            onClick={() => setShowMap((v) => !v)}
          >
            <MapIcon aria-hidden />
            {showMap ? 'Hide map' : 'Show map'}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside
          className="bg-card grid gap-4 self-start rounded-xl border p-4 text-sm shadow-xs lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
          aria-labelledby="filters-heading"
        >
          <h2
            id="filters-heading"
            className="text-brand flex items-center gap-2 border-b pb-3 text-base font-semibold"
          >
            <SlidersHorizontal className="text-teal size-4" aria-hidden />
            Filters
          </h2>
          <div className="grid gap-1.5">
            <label htmlFor="f-category" className={filterLabelClass}>
              Vehicle type
            </label>
            <select
              id="f-category"
              className={selectClass}
              value={state.categoryId ?? ''}
              onChange={(e) => update({ categoryId: e.target.value || undefined })}
            >
              <option value="">Any</option>
              {(ref?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="f-transmission" className={filterLabelClass}>
              Transmission
            </label>
            <select
              id="f-transmission"
              className={selectClass}
              value={state.transmission ?? ''}
              onChange={(e) =>
                update({
                  transmission: (e.target.value || undefined) as SearchState['transmission'],
                })
              }
            >
              <option value="">Any</option>
              {(Object.keys(TRANSMISSION_LABEL) as (keyof typeof TRANSMISSION_LABEL)[]).map((t) => (
                <option key={t} value={t}>
                  {TRANSMISSION_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="f-fuel" className={filterLabelClass}>
              Fuel
            </label>
            <select
              id="f-fuel"
              className={selectClass}
              value={state.fuelType ?? ''}
              onChange={(e) =>
                update({ fuelType: (e.target.value || undefined) as SearchState['fuelType'] })
              }
            >
              <option value="">Any</option>
              {(Object.keys(FUEL_LABEL) as (keyof typeof FUEL_LABEL)[]).map((f) => (
                <option key={f} value={f}>
                  {FUEL_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="f-seats" className={filterLabelClass}>
              Minimum seats
            </label>
            <Input
              id="f-seats"
              className="bg-card h-9"
              type="number"
              min={1}
              max={60}
              value={state.minSeats ?? ''}
              onChange={(e) =>
                update({ minSeats: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <p id="f-price-label" className={filterLabelClass}>
              Daily price (LKR)
            </p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="f-price-label">
              <Input
                id="f-price-min"
                className="bg-card h-9"
                inputMode="numeric"
                placeholder="Min"
                aria-label="Minimum daily price (LKR)"
                defaultValue={state.minDailyRate ?? ''}
                onBlur={(e) => update({ minDailyRate: e.target.value.trim() || undefined })}
              />
              <Input
                id="f-price-max"
                className="bg-card h-9"
                inputMode="numeric"
                placeholder="Max"
                aria-label="Maximum daily price (LKR)"
                defaultValue={state.maxDailyRate ?? ''}
                onBlur={(e) => update({ maxDailyRate: e.target.value.trim() || undefined })}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 border-t pt-4">
            <Checkbox
              checked={state.hasAc === true}
              onCheckedChange={(checked) => update({ hasAc: checked === true ? true : undefined })}
            />
            <span>Air conditioning</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox
              checked={state.deliveryAvailable === true}
              onCheckedChange={(checked) =>
                update({ deliveryAvailable: checked === true ? true : undefined })
              }
            />
            <span>Delivery available</span>
          </label>
          <Button
            variant="outline"
            size="sm"
            className="text-teal-strong mt-1"
            onClick={() =>
              router.push(
                searchHref({
                  placeId: state.placeId,
                  startDate: state.startDate,
                  endDate: state.endDate,
                }),
              )
            }
          >
            Clear filters
          </Button>
        </aside>

        <section className="grid min-h-[85vh] content-start gap-4" aria-label="Results">
          {showMap ? (
            <SearchMap
              points={points}
              onSelect={setHighlighted}
              note="Pins show the approximate pickup area (about 500 m). The exact pickup point is shared after a booking is confirmed."
              unavailableText="Map unavailable; results are listed below."
            />
          ) : null}
          {status.kind === 'error' ? (
            <FormMessage variant="destructive">{status.message}</FormMessage>
          ) : null}
          {status.kind === 'loading' && cards.length === 0 ? (
            <>
              <p className="sr-only" role="status">
                Searching…
              </p>
              {[0, 1, 2].map((n) => (
                <div
                  key={n}
                  aria-hidden
                  className="bg-card flex flex-col overflow-hidden rounded-xl border sm:flex-row"
                >
                  <div className="bg-surface-subtle aspect-[4/3] w-full animate-pulse sm:aspect-auto sm:min-h-52 sm:w-64 md:w-72" />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="bg-surface-subtle h-5 w-1/2 animate-pulse rounded" />
                    <div className="bg-surface-subtle h-4 w-3/4 animate-pulse rounded" />
                    <div className="bg-surface-subtle h-4 w-1/3 animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </>
          ) : null}
          {status.kind === 'ready' && cards.length === 0 ? (
            <div className="bg-card flex flex-col items-center gap-2 rounded-xl border px-6 py-12 text-center">
              <SearchX className="text-teal size-8" aria-hidden />
              <h2 className="text-lg font-semibold">No vehicles match this search</h2>
              <p className="text-muted-foreground max-w-md text-sm">
                Try another town, different dates or fewer filters. New providers are joining the
                platform as we grow across the South Coast.
              </p>
            </div>
          ) : null}
          {cards.map((card, index) => (
            <VehicleCard
              key={card.id}
              card={card}
              state={state}
              reference={ref}
              highlighted={highlighted === card.id}
              priority={index === 0}
            />
          ))}
          {nextCursor ? (
            <Button
              variant="outline"
              disabled={status.kind === 'loading'}
              onClick={() => void load(nextCursor)}
            >
              {status.kind === 'loading' ? 'Loading…' : 'Show more'}
            </Button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
