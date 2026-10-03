'use client';

import type { PublicVehicleCard, SearchCriteria } from '@vrp/contracts';
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
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

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

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {criteria?.place
              ? `Vehicles near ${criteria.place.name}`
              : state.districtId
                ? `Vehicles in ${state.districtId}`
                : 'Vehicles on the South Coast'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {criteria?.startsAt && criteria.endsAt
              ? `${formatDay(criteria.startsAt)} → ${formatDay(criteria.endsAt)} · ${criteria.days} day${criteria.days === 1 ? '' : 's'} · only vehicles free for the whole window`
              : 'Add dates to see real availability and an estimated total.'}
            {status.kind === 'ready'
              ? ` · ${cards.length}${nextCursor ? '+' : ''} result${cards.length === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm" htmlFor="sort">
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
          <Button variant="outline" size="sm" onClick={() => setShowMap((v) => !v)}>
            {showMap ? 'Hide map' : 'Show map'}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="grid gap-4 self-start rounded-lg border p-4 text-sm">
          <h2 className="font-medium">Filters</h2>
          <div className="grid gap-1.5">
            <label htmlFor="f-category">Vehicle type</label>
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
            <label htmlFor="f-transmission">Transmission</label>
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
            <label htmlFor="f-fuel">Fuel</label>
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
            <label htmlFor="f-seats">Minimum seats</label>
            <Input
              id="f-seats"
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
            <label>Daily price (LKR)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                inputMode="numeric"
                placeholder="Min"
                defaultValue={state.minDailyRate ?? ''}
                onBlur={(e) => update({ minDailyRate: e.target.value.trim() || undefined })}
              />
              <Input
                inputMode="numeric"
                placeholder="Max"
                defaultValue={state.maxDailyRate ?? ''}
                onBlur={(e) => update({ maxDailyRate: e.target.value.trim() || undefined })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={state.hasAc === true}
              onCheckedChange={(checked) => update({ hasAc: checked === true ? true : undefined })}
            />
            <span>Air conditioning</span>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={state.deliveryAvailable === true}
              onCheckedChange={(checked) =>
                update({ deliveryAvailable: checked === true ? true : undefined })
              }
            />
            <span>Delivery available</span>
          </label>
          <Button
            variant="ghost"
            size="sm"
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

        <section className="grid gap-4">
          {showMap ? (
            <SearchMap
              points={points}
              onSelect={setHighlighted}
              note="Pins show the approximate pickup area (about 500 m). The exact pickup point is shared after a booking is confirmed."
            />
          ) : null}
          {status.kind === 'error' ? (
            <FormMessage variant="destructive">{status.message}</FormMessage>
          ) : null}
          {status.kind === 'loading' && cards.length === 0 ? (
            <p className="text-muted-foreground text-sm">Searching…</p>
          ) : null}
          {status.kind === 'ready' && cards.length === 0 ? (
            <FormMessage title="No vehicles match this search">
              Try another town, different dates or fewer filters. New providers are joining the
              platform as we grow across the South Coast.
            </FormMessage>
          ) : null}
          {cards.map((card) => (
            <VehicleCard
              key={card.id}
              card={card}
              state={state}
              reference={ref}
              highlighted={highlighted === card.id}
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
