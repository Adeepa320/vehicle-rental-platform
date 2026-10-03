'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useReferenceData } from '@/lib/reference';
import { searchHref, type SearchState } from '@/lib/search-params';
import { todayInColombo } from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface SearchFormProps {
  initial?: Partial<SearchState>;
  compact?: boolean;
}

/** Home / results search box: place from the gazetteer, optional dates and category. */
export function SearchForm({ initial = {}, compact = false }: SearchFormProps) {
  const router = useRouter();
  const reference = useReferenceData();
  const [placeId, setPlaceId] = useState(initial.placeId ?? '');
  const [startDate, setStartDate] = useState(initial.startDate ?? '');
  const [endDate, setEndDate] = useState(initial.endDate ?? '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [error, setError] = useState<string | null>(null);

  const places = reference.status === 'ready' ? reference.data.places : [];
  const districts = reference.status === 'ready' ? reference.data.districts : [];
  const launch = places.filter((p) => p.isLaunchArea);
  const others = places.filter((p) => !p.isLaunchArea);
  const districtName = (id: string) => districts.find((d) => d.id === id)?.name ?? id;

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if ((startDate && !endDate) || (!startDate && endDate)) {
      setError('Choose both a pickup and a return day, or leave both empty.');
      return;
    }
    if (startDate && endDate && endDate <= startDate) {
      setError('The return day must be after the pickup day.');
      return;
    }
    router.push(
      searchHref({
        ...initial,
        placeId: placeId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        categoryId: categoryId || undefined,
      }),
    );
  }

  const today = todayInColombo();
  return (
    <form
      className={`grid gap-3 ${compact ? 'sm:grid-cols-[2fr_1fr_1fr_1fr_auto]' : 'rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]'}`}
      onSubmit={submit}
      noValidate
    >
      <div className="grid gap-1.5">
        <Label htmlFor="placeId">Where</Label>
        <select
          id="placeId"
          className={selectClass}
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
        >
          <option value="">Anywhere on the South Coast</option>
          {launch.length > 0 ? (
            <optgroup label="Launch towns">
              {launch.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {districtName(p.districtId)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {others.length > 0 ? (
            <optgroup label="Other places">
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {districtName(p.districtId)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="startDate">Pickup</Label>
        <Input
          id="startDate"
          type="date"
          min={today}
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            if (e.target.value && (!endDate || endDate <= e.target.value))
              setEndDate(addDays(e.target.value, 3));
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="endDate">Return</Label>
        <Input
          id="endDate"
          type="date"
          min={startDate || today}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="categoryId">Vehicle</Label>
        <select
          id="categoryId"
          className={selectClass}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Any type</option>
          {(reference.status === 'ready' ? reference.data.categories : []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" className="w-full">
          Search
        </Button>
      </div>
      {error ? <p className="text-destructive text-xs sm:col-span-full">{error}</p> : null}
    </form>
  );
}
