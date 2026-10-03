'use client';

import {
  CreateProviderLocationRequestSchema,
  type CreateProviderLocationRequest,
  type ProviderLocation,
} from '@vrp/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { districtName, placeName, useReferenceData, type ReferenceData } from '@/lib/reference';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

interface LocationForm {
  name: string;
  districtId: string;
  placeId: string;
  addressText: string;
  lat: string;
  lng: string;
  pickupInstructions: string;
  isPrimary: boolean;
}

const EMPTY: LocationForm = {
  name: '',
  districtId: '',
  placeId: '',
  addressText: '',
  lat: '',
  lng: '',
  pickupInstructions: '',
  isPrimary: false,
};

function fromLocation(location: ProviderLocation): LocationForm {
  return {
    name: location.name,
    districtId: location.districtId,
    placeId: location.placeId,
    addressText: location.addressText,
    lat: location.point ? String(location.point.lat) : '',
    lng: location.point ? String(location.point.lng) : '',
    pickupInstructions: location.pickupInstructions ?? '',
    isPrimary: location.isPrimary,
  };
}

/** Form → API payload. Both coordinates or none; empty optional text → null. */
export function toLocationPayload(form: LocationForm): Record<string, unknown> {
  const hasPoint = form.lat.trim() !== '' || form.lng.trim() !== '';
  return {
    name: form.name.trim(),
    districtId: form.districtId,
    placeId: form.placeId,
    addressText: form.addressText.trim(),
    point: hasPoint ? { lat: Number(form.lat), lng: Number(form.lng) } : null,
    pickupInstructions:
      form.pickupInstructions.trim() === '' ? null : form.pickupInstructions.trim(),
    ...(form.isPrimary ? { isPrimary: true } : {}),
  };
}

export default function ProviderLocationsPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const reference = useReferenceData();
  const [locations, setLocations] = useState<ProviderLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProviderLocation | 'new' | null>(null);

  useEffect(() => {
    if (area.status !== 'ready') return;
    let cancelled = false;
    withAccessToken((token) => api.locations.list(token))
      .then((rows) => {
        if (!cancelled) setLocations(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, withAccessToken]);

  const replace = (updated: ProviderLocation) =>
    setLocations((current) => {
      const rows = current ?? [];
      const exists = rows.some((l) => l.id === updated.id);
      const next = exists
        ? rows.map((l) => (l.id === updated.id ? updated : l))
        : [updated, ...rows];
      // Only one primary at a time.
      return next.map((l) =>
        updated.isPrimary && l.id !== updated.id ? { ...l, isPrimary: false } : l,
      );
    });

  const act = async (fn: () => Promise<ProviderLocation | void>) => {
    setError(null);
    try {
      const result = await fn();
      if (result) replace(result);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    }
  };

  if (area.status === 'loading' || locations === null || reference.status === 'loading') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <p className="text-muted-foreground text-sm">{error ?? 'Loading your locations…'}</p>
      </main>
    );
  }
  if (area.status === 'error' || reference.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive">
          {area.status === 'error' ? area.message : (reference as { message: string }).message}
        </FormMessage>
      </main>
    );
  }
  const ref = reference.data;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pickup locations</h1>
          <p className="text-muted-foreground text-sm">
            Where customers collect vehicles. District and town come from our place list; a map pin
            is optional. Exact addresses are shown to customers only after a booking is confirmed.
          </p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={editing !== null}>
          Add location
        </Button>
      </header>
      {area.profile.status === 'suspended' ? (
        <FormMessage variant="destructive" title="Your provider account is suspended">
          Locations are read-only until the suspension is lifted.
        </FormMessage>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}

      {editing !== null ? (
        <LocationEditor
          key={editing === 'new' ? 'new' : editing.id}
          reference={ref}
          initial={editing === 'new' ? null : editing}
          firstLocation={locations.length === 0}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            replace(saved);
            setEditing(null);
          }}
        />
      ) : null}

      <div className="grid gap-3">
        {locations.map((location) => (
          <div key={location.id} className="rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {location.name} {location.isPrimary ? <Badge>Primary</Badge> : null}{' '}
                  {!location.isActive ? <Badge variant="destructive">Inactive</Badge> : null}
                </p>
                <p className="text-muted-foreground text-sm">
                  {placeName(ref, location.placeId)}, {districtName(ref, location.districtId)} ·{' '}
                  {location.addressText}
                </p>
                <p className="text-muted-foreground text-xs">
                  {location.point
                    ? `Pin ${location.point.lat.toFixed(4)}, ${location.point.lng.toFixed(4)} · `
                    : 'No pin · '}
                  {location.vehicleCount} vehicle{location.vehicleCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={editing !== null}
                  onClick={() => setEditing(location)}
                >
                  Edit
                </Button>
                {location.isActive && !location.isPrimary ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(() =>
                        withAccessToken((t) =>
                          api.locations.update(t, location.id, { isPrimary: true }),
                        ),
                      )
                    }
                  >
                    Make primary
                  </Button>
                ) : null}
                {location.isActive ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={location.vehicleCount > 0}
                    title={
                      location.vehicleCount > 0
                        ? 'Move its vehicles to another location first'
                        : undefined
                    }
                    onClick={() =>
                      void act(async () => {
                        await withAccessToken((t) => api.locations.deactivate(t, location.id));
                        return { ...location, isActive: false, isPrimary: false };
                      })
                    }
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(() =>
                        withAccessToken((t) =>
                          api.locations.update(t, location.id, { isActive: true }),
                        ),
                      )
                    }
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
        {locations.length === 0 && editing === null ? (
          <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
            No locations yet. Add the place where customers will collect your vehicles.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function LocationEditor({
  reference,
  initial,
  firstLocation,
  onCancel,
  onSaved,
}: {
  reference: ReferenceData;
  initial: ProviderLocation | null;
  firstLocation: boolean;
  onCancel: () => void;
  onSaved: (location: ProviderLocation) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [form, setForm] = useState<LocationForm>(() => (initial ? fromLocation(initial) : EMPTY));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeDistricts = reference.districts.filter((d) => d.isActive);
  const places = reference.places.filter((p) => p.districtId === form.districtId);
  const update = <K extends keyof LocationForm>(key: K, value: LocationForm[K]) =>
    setForm((c) => ({ ...c, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = CreateProviderLocationRequestSchema.safeParse(toLocationPayload(form));
    if (!parsed.success) {
      const fieldErrors = fieldErrorsFromZod(parsed.error);
      if (fieldErrors.point) fieldErrors.lat = fieldErrors.point;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const payload: CreateProviderLocationRequest = parsed.data;
      const saved = initial
        ? await withAccessToken((t) => {
            const { isPrimary: _ignored, ...rest } = payload;
            return api.locations.update(t, initial.id, {
              ...rest,
              ...(form.isPrimary && !initial.isPrimary ? { isPrimary: true } : {}),
            });
          })
        : await withAccessToken((t) => api.locations.create(t, payload));
      onSaved(saved);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={initial ? `Edit ${initial.name}` : 'New pickup location'}
      description="Only districts open for providers are listed."
    >
      <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        <FormField
          id="name"
          label="Name"
          error={errors.name}
          hint='e.g. "Weligama office" or "Home, Mirissa"'
        >
          <Input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="districtId" label="District" error={errors.districtId}>
            <select
              id="districtId"
              className={selectClass}
              value={form.districtId}
              onChange={(e) => setForm((c) => ({ ...c, districtId: e.target.value, placeId: '' }))}
            >
              <option value="">Select…</option>
              {activeDistricts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="placeId" label="Town or area" error={errors.placeId}>
            <select
              id="placeId"
              className={selectClass}
              value={form.placeId}
              disabled={!form.districtId}
              onChange={(e) => update('placeId', e.target.value)}
            >
              <option value="">{form.districtId ? 'Select…' : 'Choose a district first'}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField id="addressText" label="Address" error={errors.addressText}>
          <Textarea
            id="addressText"
            className="min-h-14"
            value={form.addressText}
            onChange={(e) => update('addressText', e.target.value)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="lat"
            label="Latitude (optional)"
            error={errors.lat}
            hint="Decimal degrees inside Sri Lanka, e.g. 5.9485"
          >
            <Input
              id="lat"
              inputMode="decimal"
              value={form.lat}
              onChange={(e) => update('lat', e.target.value)}
            />
          </FormField>
          <FormField id="lng" label="Longitude (optional)" error={errors.lng} hint="e.g. 80.4718">
            <Input
              id="lng"
              inputMode="decimal"
              value={form.lng}
              onChange={(e) => update('lng', e.target.value)}
            />
          </FormField>
        </div>
        <FormField
          id="pickupInstructions"
          label="Pickup instructions (optional)"
          error={errors.pickupInstructions}
          hint="Shown to customers after a booking is confirmed."
        >
          <Textarea
            id="pickupInstructions"
            className="min-h-14"
            value={form.pickupInstructions}
            onChange={(e) => update('pickupInstructions', e.target.value)}
          />
        </FormField>
        {!initial?.isPrimary ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isPrimary || firstLocation}
              disabled={firstLocation}
              onCheckedChange={(checked) => update('isPrimary', checked === true)}
            />
            <span>
              {firstLocation
                ? 'Your first location is the primary one'
                : 'Make this my primary location'}
            </span>
          </label>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Add location'}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
