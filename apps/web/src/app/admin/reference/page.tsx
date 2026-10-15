'use client';

import {
  CreatePlaceRequestSchema,
  PlaceKindSchema,
  type AdminDistrict,
  type AdminPlace,
  type AdminVehicleCategory,
  type CreatePlaceRequest,
  type UpdateDistrictRequest,
  type UpdatePlaceRequest,
  type UpdateVehicleCategoryRequest,
} from '@vrp/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PLACE_KIND_LABEL } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

type Tab = 'districts' | 'places' | 'categories';

export default function AdminReferencePage() {
  const area = useAdminArea();
  const [tab, setTab] = useState<Tab>('districts');
  return (
    <AdminShell area={area} width="max-w-6xl">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Reference data</h1>
        <p className="text-muted-foreground text-sm">
          Districts, places and vehicle categories. Nothing is deleted: rows that listings,
          locations or bookings refer to are deactivated instead. Every change is audited.
        </p>
        {!area.isSuperAdmin ? (
          <FormMessage title="Super admin only">
            You can read reference data but not change it; editing is restricted to super admins.
          </FormMessage>
        ) : null}
      </header>
      <div className="flex gap-2">
        {(['districts', 'places', 'categories'] as const).map((t) => (
          <Button key={t} variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
            {t[0]?.toUpperCase()}
            {t.slice(1)}
          </Button>
        ))}
      </div>
      {tab === 'districts' ? (
        <DistrictsTab />
      ) : tab === 'places' ? (
        <PlacesTab />
      ) : (
        <CategoriesTab />
      )}
    </AdminShell>
  );
}

/* ------------------------------------------------------------- districts */

function DistrictsTab() {
  const { api, isSuperAdmin, withAccessToken } = useAdminArea();
  const [rows, setRows] = useState<AdminDistrict[] | null>(null);
  const [editing, setEditing] = useState<AdminDistrict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    withAccessToken((t) => api.admin.listDistricts(t))
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, withAccessToken]);

  const update = async (id: string, body: UpdateDistrictRequest) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await withAccessToken((t) => api.admin.updateDistrict(t, id, body));
      setRows((current) => current?.map((d) => (d.id === updated.id ? updated : d)) ?? null);
      setEditing(null);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4">
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">District</th>
              <th className="p-3 font-medium">Province</th>
              <th className="p-3 font-medium">Sort</th>
              <th className="p-3 font-medium">Places</th>
              <th className="p-3 font-medium">Providers</th>
              <th className="p-3 font-medium">Active</th>
              <th className="p-3 font-medium">Updated</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  {row.name} <span className="text-muted-foreground text-xs">({row.id})</span>
                </td>
                <td className="p-3">{row.province}</td>
                <td className="p-3">{row.sortOrder}</td>
                <td className="p-3">{row.placeCount}</td>
                <td className="p-3">{row.providerCount}</td>
                <td className="p-3">
                  <Badge variant={row.isActive ? 'default' : 'outline'}>
                    {row.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="p-3">{formatDateTime(row.updatedAt)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!isSuperAdmin || busy}
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>{' '}
                  <Button
                    size="sm"
                    variant={row.isActive ? 'destructive' : 'default'}
                    disabled={!isSuperAdmin || busy}
                    onClick={() => void update(row.id, { isActive: !row.isActive })}
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
            {rows === null ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={8}>
                  Loading districts…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <DistrictForm
          district={editing}
          busy={busy}
          onSubmit={(body) => update(editing.id, body)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function DistrictForm({
  district,
  busy,
  onSubmit,
  onCancel,
}: {
  district: AdminDistrict;
  busy: boolean;
  onSubmit: (body: UpdateDistrictRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(district.name);
  const [province, setProvince] = useState(district.province);
  const [sortOrder, setSortOrder] = useState(String(district.sortOrder));
  return (
    <form
      className="grid gap-3 rounded-md border p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const body: UpdateDistrictRequest = {};
        if (name.trim() !== district.name) body.name = name.trim();
        if (province.trim() !== district.province) body.province = province.trim();
        if (Number(sortOrder) !== district.sortOrder) body.sortOrder = Number(sortOrder);
        if (Object.keys(body).length === 0) return onCancel();
        void onSubmit(body);
      }}
    >
      <p className="text-sm font-medium">Edit {district.id}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="district-name" label="Name">
          <Input id="district-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField id="district-province" label="Province">
          <Input
            id="district-province"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
          />
        </FormField>
        <FormField id="district-sort" label="Sort order">
          <Input
            id="district-sort"
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- places */

function PlacesTab() {
  const { api, isSuperAdmin, withAccessToken } = useAdminArea();
  const [districts, setDistricts] = useState<AdminDistrict[]>([]);
  const [districtId, setDistrictId] = useState('');
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [rows, setRows] = useState<AdminPlace[] | null>(null);
  const [editing, setEditing] = useState<AdminPlace | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    withAccessToken((t) => api.admin.listDistricts(t))
      .then((result) => {
        if (!cancelled) setDistricts(result);
      })
      .catch(() => {
        // District names are a convenience; the places list still renders with ids.
      });
    return () => {
      cancelled = true;
    };
  }, [api, withAccessToken]);

  const search = q.trim();
  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(
        await withAccessToken((t) =>
          api.admin.listPlaces(t, {
            districtId: districtId || undefined,
            q: search || undefined,
            includeInactive,
          }),
        ),
      );
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    }
  }, [api, districtId, includeInactive, search, withAccessToken]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const districtName = (id: string) => districts.find((d) => d.id === id)?.name ?? id;

  const update = async (id: string, body: UpdatePlaceRequest) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await withAccessToken((t) => api.admin.updatePlace(t, id, body));
      setRows((current) => current?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
      setEditing(null);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={selectClass}
          value={districtId}
          onChange={(e) => setDistrictId(e.target.value)}
          aria-label="District"
        >
          <option value="">All districts</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Input
          className="w-56"
          placeholder="Search name or slug"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(checked === true)}
          />
          Include inactive
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!isSuperAdmin || busy}
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? 'Close form' : 'New place'}
        </Button>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {creating ? (
        <PlaceCreateForm
          districts={districts}
          busy={busy}
          onCreated={(place) => {
            setRows((current) => [place, ...(current ?? [])]);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Place</th>
              <th className="p-3 font-medium">Kind</th>
              <th className="p-3 font-medium">District</th>
              <th className="p-3 font-medium">Centre</th>
              <th className="p-3 font-medium">Radius</th>
              <th className="p-3 font-medium">Launch</th>
              <th className="p-3 font-medium">Rank</th>
              <th className="p-3 font-medium">Locations</th>
              <th className="p-3 font-medium">Active</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  {row.name} <span className="text-muted-foreground text-xs">({row.slug})</span>
                  {row.aliases.length > 0 ? (
                    <span className="text-muted-foreground block text-xs">
                      aka {row.aliases.join(', ')}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">{PLACE_KIND_LABEL[row.kind]}</td>
                <td className="p-3">{districtName(row.districtId)}</td>
                <td className="p-3 font-mono text-xs">
                  {row.centre.lat.toFixed(4)}, {row.centre.lng.toFixed(4)}
                </td>
                <td className="p-3">{row.defaultRadiusKm} km</td>
                <td className="p-3">{row.isLaunchArea ? 'Yes' : '—'}</td>
                <td className="p-3">{row.searchRank}</td>
                <td className="p-3">{row.locationCount}</td>
                <td className="p-3">
                  <Badge variant={row.isActive ? 'default' : 'outline'}>
                    {row.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!isSuperAdmin || busy}
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>{' '}
                  <Button
                    size="sm"
                    variant={row.isActive ? 'destructive' : 'default'}
                    disabled={!isSuperAdmin || busy}
                    onClick={() => void update(row.id, { isActive: !row.isActive })}
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
            {rows === null ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={10}>
                  Loading places…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={10}>
                  No places match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <PlaceEditForm
          place={editing}
          districts={districts}
          busy={busy}
          onSubmit={(body) => update(editing.id, body)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

interface PlaceDraft {
  slug: string;
  name: string;
  kind: AdminPlace['kind'];
  districtId: string;
  lat: string;
  lng: string;
  defaultRadiusKm: string;
  searchRank: string;
  isLaunchArea: boolean;
}

function PlaceFields({
  draft,
  districts,
  errors,
  onChange,
  withSlug,
}: {
  draft: PlaceDraft;
  districts: AdminDistrict[];
  errors: FieldErrors;
  onChange: (patch: Partial<PlaceDraft>) => void;
  withSlug: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {withSlug ? (
        <FormField
          id="place-slug"
          label="Slug"
          error={errors.slug}
          hint="lower-case, digits, hyphens"
        >
          <Input
            id="place-slug"
            value={draft.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
          />
        </FormField>
      ) : null}
      <FormField id="place-name" label="Name" error={errors.name}>
        <Input
          id="place-name"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </FormField>
      <FormField id="place-kind" label="Kind" error={errors.kind}>
        <select
          id="place-kind"
          className={`${selectClass} w-full`}
          value={draft.kind}
          onChange={(e) => onChange({ kind: e.target.value as AdminPlace['kind'] })}
        >
          {PlaceKindSchema.options.map((k) => (
            <option key={k} value={k}>
              {PLACE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="place-district" label="District" error={errors.districtId}>
        <select
          id="place-district"
          className={`${selectClass} w-full`}
          value={draft.districtId}
          onChange={(e) => onChange({ districtId: e.target.value })}
        >
          <option value="">Choose…</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="place-lat" label="Centre latitude" error={errors.centre}>
        <Input
          id="place-lat"
          type="number"
          step="any"
          value={draft.lat}
          onChange={(e) => onChange({ lat: e.target.value })}
        />
      </FormField>
      <FormField id="place-lng" label="Centre longitude">
        <Input
          id="place-lng"
          type="number"
          step="any"
          value={draft.lng}
          onChange={(e) => onChange({ lng: e.target.value })}
        />
      </FormField>
      <FormField
        id="place-radius"
        label="Default radius (km, 1–100)"
        error={errors.defaultRadiusKm}
      >
        <Input
          id="place-radius"
          type="number"
          step="any"
          value={draft.defaultRadiusKm}
          onChange={(e) => onChange({ defaultRadiusKm: e.target.value })}
        />
      </FormField>
      <FormField id="place-rank" label="Search rank (0–1000)" error={errors.searchRank}>
        <Input
          id="place-rank"
          type="number"
          value={draft.searchRank}
          onChange={(e) => onChange({ searchRank: e.target.value })}
        />
      </FormField>
      <FormField id="place-launch" label="Launch area">
        <select
          id="place-launch"
          className={`${selectClass} w-full`}
          value={draft.isLaunchArea ? 'true' : 'false'}
          onChange={(e) => onChange({ isLaunchArea: e.target.value === 'true' })}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </FormField>
    </div>
  );
}

/** Editor text → request payload (numbers parsed; empty optional fields dropped). */
function placePayload(draft: PlaceDraft): Record<string, unknown> {
  return {
    slug: draft.slug.trim(),
    name: draft.name.trim(),
    kind: draft.kind,
    districtId: draft.districtId,
    centre: { lat: Number(draft.lat), lng: Number(draft.lng) },
    ...(draft.defaultRadiusKm.trim() ? { defaultRadiusKm: Number(draft.defaultRadiusKm) } : {}),
    ...(draft.searchRank.trim() ? { searchRank: Number(draft.searchRank) } : {}),
    isLaunchArea: draft.isLaunchArea,
  };
}

function PlaceCreateForm({
  districts,
  busy,
  onCreated,
  onCancel,
}: {
  districts: AdminDistrict[];
  busy: boolean;
  onCreated: (place: AdminPlace) => void;
  onCancel: () => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [draft, setDraft] = useState<PlaceDraft>({
    slug: '',
    name: '',
    kind: 'town',
    districtId: '',
    lat: '',
    lng: '',
    defaultRadiusKm: '',
    searchRank: '',
    isLaunchArea: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = CreatePlaceRequestSchema.safeParse(placePayload(draft));
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const body: CreatePlaceRequest = parsed.data;
      onCreated(await withAccessToken((t) => api.admin.createPlace(t, body)));
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-md border p-4" onSubmit={(e) => void submit(e)} noValidate>
      <p className="text-sm font-medium">New place</p>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <PlaceFields
        draft={draft}
        districts={districts}
        errors={errors}
        withSlug
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || saving}>
          {saving ? 'Creating…' : 'Create place'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PlaceEditForm({
  place,
  districts,
  busy,
  onSubmit,
  onCancel,
}: {
  place: AdminPlace;
  districts: AdminDistrict[];
  busy: boolean;
  onSubmit: (body: UpdatePlaceRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlaceDraft>({
    slug: place.slug,
    name: place.name,
    kind: place.kind,
    districtId: place.districtId,
    lat: String(place.centre.lat),
    lng: String(place.centre.lng),
    defaultRadiusKm: String(place.defaultRadiusKm),
    searchRank: String(place.searchRank),
    isLaunchArea: place.isLaunchArea,
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  return (
    <form
      className="grid gap-3 rounded-md border p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = CreatePlaceRequestSchema.safeParse(placePayload(draft));
        if (!parsed.success) {
          setErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        setErrors({});
        const next = parsed.data;
        const body: UpdatePlaceRequest = {};
        if (next.name !== place.name) body.name = next.name;
        if (next.kind !== place.kind) body.kind = next.kind;
        if (next.districtId !== place.districtId) body.districtId = next.districtId;
        if (next.centre.lat !== place.centre.lat || next.centre.lng !== place.centre.lng)
          body.centre = next.centre;
        if (next.defaultRadiusKm !== undefined && next.defaultRadiusKm !== place.defaultRadiusKm)
          body.defaultRadiusKm = next.defaultRadiusKm;
        if (next.searchRank !== undefined && next.searchRank !== place.searchRank)
          body.searchRank = next.searchRank;
        if (next.isLaunchArea !== place.isLaunchArea) body.isLaunchArea = next.isLaunchArea;
        if (Object.keys(body).length === 0) return onCancel();
        void onSubmit(body);
      }}
    >
      <p className="text-sm font-medium">
        Edit {place.name} <span className="text-muted-foreground text-xs">({place.slug})</span>
      </p>
      <PlaceFields
        draft={draft}
        districts={districts}
        errors={errors}
        withSlug={false}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- categories */

function CategoriesTab() {
  const { api, isSuperAdmin, withAccessToken } = useAdminArea();
  const [rows, setRows] = useState<AdminVehicleCategory[] | null>(null);
  const [editing, setEditing] = useState<AdminVehicleCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    withAccessToken((t) => api.admin.listVehicleCategories(t))
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, withAccessToken]);

  const update = async (id: string, body: UpdateVehicleCategoryRequest) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await withAccessToken((t) => api.admin.updateVehicleCategory(t, id, body));
      setRows((current) => current?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
      setEditing(null);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4">
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Icon</th>
              <th className="p-3 font-medium">Sort</th>
              <th className="p-3 font-medium">Licence class</th>
              <th className="p-3 font-medium">Vehicles</th>
              <th className="p-3 font-medium">Active</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  {row.name} <span className="text-muted-foreground text-xs">({row.id})</span>
                  {row.activationBlockedReason ? (
                    <span className="text-muted-foreground block max-w-md text-xs">
                      {row.activationBlockedReason}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">{row.icon ?? '—'}</td>
                <td className="p-3">{row.sortOrder}</td>
                <td className="p-3">{row.requiresLicenceClass ?? '—'}</td>
                <td className="p-3">{row.vehicleCount}</td>
                <td className="p-3">
                  <Badge variant={row.isActive ? 'default' : 'outline'}>
                    {row.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!isSuperAdmin || busy}
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>{' '}
                  <Button
                    size="sm"
                    variant={row.isActive ? 'destructive' : 'default'}
                    disabled={
                      !isSuperAdmin ||
                      busy ||
                      (!row.isActive && row.activationBlockedReason !== null)
                    }
                    title={row.activationBlockedReason ?? undefined}
                    onClick={() => void update(row.id, { isActive: !row.isActive })}
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
            {rows === null ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={7}>
                  Loading categories…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <CategoryForm
          category={editing}
          busy={busy}
          onSubmit={(body) => update(editing.id, body)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function CategoryForm({
  category,
  busy,
  onSubmit,
  onCancel,
}: {
  category: AdminVehicleCategory;
  busy: boolean;
  onSubmit: (body: UpdateVehicleCategoryRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon ?? '');
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [licence, setLicence] = useState(category.requiresLicenceClass ?? '');
  return (
    <form
      className="grid gap-3 rounded-md border p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const body: UpdateVehicleCategoryRequest = {};
        if (name.trim() !== category.name) body.name = name.trim();
        if ((icon.trim() || null) !== category.icon) body.icon = icon.trim() || null;
        if (Number(sortOrder) !== category.sortOrder) body.sortOrder = Number(sortOrder);
        if ((licence.trim() || null) !== category.requiresLicenceClass)
          body.requiresLicenceClass = licence.trim() || null;
        if (Object.keys(body).length === 0) return onCancel();
        void onSubmit(body);
      }}
    >
      <p className="text-sm font-medium">Edit {category.id}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField id="category-name" label="Name">
          <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField id="category-icon" label="Icon (optional)">
          <Input id="category-icon" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </FormField>
        <FormField id="category-sort" label="Sort order">
          <Input
            id="category-sort"
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </FormField>
        <FormField id="category-licence" label="Licence class (optional)">
          <Input
            id="category-licence"
            value={licence}
            onChange={(e) => setLicence(e.target.value)}
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
