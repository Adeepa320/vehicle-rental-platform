'use client';

import { Search as SearchIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useReferenceData } from '@/lib/reference';
import { searchHref, type SearchState } from '@/lib/search-params';
import { todayInColombo } from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-card h-11 w-full rounded-lg border px-3 text-sm focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-[3px]';
const inputClass = 'bg-card h-11 rounded-lg px-3';
const labelClass = 'text-muted-foreground text-xs font-semibold tracking-wide uppercase';

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
      className={`bg-card text-card-foreground grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] ${compact ? 'rounded-xl border p-3 shadow-xs' : 'rounded-2xl p-4 shadow-xl ring-1 ring-black/5 sm:p-5'}`}
      onSubmit={submit}
      noValidate
    >
      <div className="grid gap-1.5">
        <Label htmlFor="placeId" className={labelClass}>
          Where
        </Label>
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
        <Label htmlFor="startDate" className={labelClass}>
          Pickup
        </Label>
        <Input
          id="startDate"
          type="date"
          className={inputClass}
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
        <Label htmlFor="endDate" className={labelClass}>
          Return
        </Label>
        <Input
          id="endDate"
          type="date"
          className={inputClass}
          min={startDate || today}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="categoryId" className={labelClass}>
          Vehicle
        </Label>
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
      <div className="flex items-end sm:col-span-2 lg:col-span-1">
        <Button type="submit" variant="cta" size="xl" className="w-full lg:px-6">
          <SearchIcon aria-hidden />
          Search
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-sm sm:col-span-full" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
