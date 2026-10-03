'use client';

import {
  UpdateVehicleRequestSchema,
  categoryRule,
  formatLkr,
  type ProviderLocation,
  type UpdateVehicleRequest,
  type Vehicle,
  type VehicleSpecField,
} from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { PhotoManager } from '@/components/provider/photo-manager';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { formatDate } from '@/lib/provider-labels';
import { useReferenceData, type ReferenceData } from '@/lib/reference';
import { fromVehicle, toVehiclePatch, type VehicleFormState } from '@/lib/vehicle-form';
import {
  FUEL_LABEL,
  FUEL_POLICY_LABEL,
  TRANSMISSION_LABEL,
  VEHICLE_STATUS,
  vehicleTitle,
} from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px] disabled:opacity-50';

export default function VehicleDetailPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const reference = useReferenceData();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [locations, setLocations] = useState<ProviderLocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (area.status !== 'ready' || !params.id) return;
    let cancelled = false;
    Promise.all([
      withAccessToken((t) => api.vehicles.get(t, params.id)),
      withAccessToken((t) => api.locations.list(t)),
    ])
      .then(([v, l]) => {
        if (cancelled) return;
        setVehicle(v);
        setLocations(l);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, params.id, withAccessToken]);

  if (area.status === 'error' || error || reference.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive">
          {area.status === 'error'
            ? area.message
            : (error ?? (reference as { message?: string }).message)}
        </FormMessage>
      </main>
    );
  }
  if (area.status !== 'ready' || !vehicle || reference.status !== 'ready') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading the listing…</p>
      </main>
    );
  }

  const meta = VEHICLE_STATUS[vehicle.status];
  const suspendedProvider = area.profile.status === 'suspended';

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <Link
        href="/provider/vehicles"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← All vehicles
      </Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{vehicleTitle(vehicle)}</h1>
          <Badge variant={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">{meta.description}</p>
        {vehicle.reviewReason &&
        (vehicle.status === 'changes_requested' || vehicle.status === 'rejected') ? (
          <FormMessage variant="destructive" title="Message from our review team">
            <p className="whitespace-pre-wrap">{vehicle.reviewReason}</p>
          </FormMessage>
        ) : null}
        {vehicle.status === 'suspended' && vehicle.suspensionReason ? (
          <FormMessage variant="destructive" title="Suspended by the platform">
            <p className="whitespace-pre-wrap">{vehicle.suspensionReason}</p>
          </FormMessage>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {vehicle.submittedAt ? `Submitted ${formatDate(vehicle.submittedAt)} · ` : ''}
          {vehicle.approvedAt ? `Approved ${formatDate(vehicle.approvedAt)} · ` : ''}
          Last updated {formatDate(vehicle.updatedAt)}
        </p>
        {(vehicle.status === 'approved' || vehicle.status === 'inactive') && !suspendedProvider ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/provider/vehicles/${vehicle.id}/availability`} />}
            >
              Manage availability
            </Button>
            <LifecycleButton vehicle={vehicle} onChanged={setVehicle} />
          </div>
        ) : null}
      </header>

      <PhotoManager
        vehicleId={vehicle.id}
        photos={vehicle.photos}
        editable={!suspendedProvider && vehicle.editable === 'all'}
        onChanged={() => {
          void withAccessToken((t) => api.vehicles.get(t, vehicle.id)).then(setVehicle);
        }}
      />

      <VehicleForm
        key={vehicle.updatedAt}
        vehicle={vehicle}
        locations={locations}
        reference={reference.data}
        readOnly={suspendedProvider || vehicle.editable === 'none'}
        onSaved={setVehicle}
      />
    </main>
  );
}

function LifecycleButton({
  vehicle,
  onChanged,
}: {
  vehicle: Vehicle;
  onChanged: (v: Vehicle) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deactivate = vehicle.status === 'approved';
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onChanged(
              await withAccessToken((t) =>
                deactivate
                  ? api.vehicles.deactivate(t, vehicle.id)
                  : api.vehicles.activate(t, vehicle.id),
              ),
            );
          } catch (caught) {
            setError(submitErrorFrom(caught).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : deactivate ? 'Take offline' : 'Put back online'}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </>
  );
}

function VehicleForm({
  vehicle,
  locations,
  reference,
  readOnly,
  onSaved,
}: {
  vehicle: Vehicle;
  locations: ProviderLocation[];
  reference: ReferenceData;
  readOnly: boolean;
  onSaved: (v: Vehicle) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [form, setForm] = useState<VehicleFormState>(() => fromVehicle(vehicle));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{
    variant: 'default' | 'destructive';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);

  const mode = vehicle.editable === 'operational' ? 'operational' : 'all';
  const identityLocked = readOnly || vehicle.editable !== 'all';
  const rule = categoryRule(form.categoryId);
  const show = (field: VehicleSpecField) => !rule.notApplicable.includes(field);
  const req = (field: VehicleSpecField) => (rule.required.includes(field) ? ' *' : '');
  const update = <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]) =>
    setForm((c) => ({ ...c, [key]: value }));
  const activeLocations = locations.filter((l) => l.isActive || l.id === vehicle.locationId);

  async function save(thenSubmit: boolean, event?: FormEvent) {
    event?.preventDefault();
    setMessage(null);
    const parsed = UpdateVehicleRequestSchema.safeParse(toVehiclePatch(form, mode));
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      setMessage({ variant: 'destructive', text: 'Please check the highlighted fields.' });
      return;
    }
    setErrors({});
    setBusy(thenSubmit ? 'submit' : 'save');
    try {
      const saved = await withAccessToken((t) =>
        api.vehicles.update(t, vehicle.id, parsed.data as UpdateVehicleRequest),
      );
      if (!thenSubmit) {
        onSaved(saved);
        setMessage({ variant: 'default', text: 'Saved.' });
        return;
      }
      onSaved(await withAccessToken((t) => api.vehicles.submit(t, vehicle.id)));
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage({ variant: 'destructive', text: failure.message });
    } finally {
      setBusy(null);
    }
  }

  const checklist = vehicle.submissionIssues;

  return (
    <form className="grid gap-6" onSubmit={(e) => void save(true, e)} noValidate>
      {message ? <FormMessage variant={message.variant}>{message.text}</FormMessage> : null}
      {vehicle.editable === 'operational' ? (
        <FormMessage title="Identity fields are locked">
          Make, model, year, plate and specifications cannot change after approval. Title,
          description, pricing, rules and the pickup location can.
        </FormMessage>
      ) : null}

      <AuthCard title="Basics">
        <div className="grid gap-4">
          <FormField
            id="title"
            label="Listing title"
            error={errors.title}
            hint="3–80 characters; what customers will see."
          >
            <Input
              id="title"
              value={form.title}
              disabled={readOnly}
              onChange={(e) => update('title', e.target.value)}
            />
          </FormField>
          <FormField
            id="internalName"
            label="Internal reference (optional, never public)"
            error={errors.internalName}
          >
            <Input
              id="internalName"
              value={form.internalName}
              disabled={readOnly}
              onChange={(e) => update('internalName', e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="categoryId" label="Category" error={errors.categoryId}>
              <select
                id="categoryId"
                className={selectClass}
                value={form.categoryId}
                disabled={identityLocked}
                onChange={(e) => update('categoryId', e.target.value)}
              >
                {reference.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {!reference.categories.some((c) => c.id === form.categoryId) && form.categoryId ? (
                  <option value={form.categoryId}>{form.categoryId}</option>
                ) : null}
              </select>
            </FormField>
            <FormField id="locationId" label="Pickup location" error={errors.locationId}>
              <select
                id="locationId"
                className={selectClass}
                value={form.locationId}
                disabled={readOnly}
                onChange={(e) => update('locationId', e.target.value)}
              >
                <option value="">Select…</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.isPrimary ? ' (primary)' : ''}
                    {!l.isActive ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
              {locations.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  <Link href="/provider/locations" className="underline">
                    Add a pickup location
                  </Link>{' '}
                  first.
                </p>
              ) : null}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="make" label="Make" error={errors.make}>
              <Input
                id="make"
                value={form.make}
                disabled={identityLocked}
                onChange={(e) => update('make', e.target.value)}
              />
            </FormField>
            <FormField id="model" label="Model" error={errors.model}>
              <Input
                id="model"
                value={form.model}
                disabled={identityLocked}
                onChange={(e) => update('model', e.target.value)}
              />
            </FormField>
            <FormField id="modelYear" label="Year" error={errors.modelYear}>
              <Input
                id="modelYear"
                type="number"
                value={form.modelYear}
                disabled={identityLocked}
                onChange={(e) => update('modelYear', e.target.value)}
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="registrationNumber"
              label="Registration number"
              error={errors.registrationNumber}
              hint="As on the plate, e.g. CAB-1234. Never shown to customers in full."
            >
              <Input
                id="registrationNumber"
                value={form.registrationNumber}
                disabled={identityLocked}
                onChange={(e) => update('registrationNumber', e.target.value)}
              />
            </FormField>
            <FormField id="color" label="Colour (optional)" error={errors.color}>
              <Input
                id="color"
                value={form.color}
                disabled={identityLocked}
                onChange={(e) => update('color', e.target.value)}
              />
            </FormField>
          </div>
          <FormField
            id="description"
            label="Description"
            error={errors.description}
            hint="20–2000 characters. Condition, what is included, who it suits."
          >
            <Textarea
              id="description"
              value={form.description}
              disabled={readOnly}
              onChange={(e) => update('description', e.target.value)}
            />
          </FormField>
        </div>
      </AuthCard>

      <AuthCard
        title="Specifications"
        description={`Fields marked * are required for this category.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {show('transmission') ? (
            <FormField
              id="transmission"
              label={`Transmission${req('transmission')}`}
              error={errors.transmission}
            >
              <select
                id="transmission"
                className={selectClass}
                value={form.transmission}
                disabled={identityLocked}
                onChange={(e) =>
                  update('transmission', e.target.value as VehicleFormState['transmission'])
                }
              >
                <option value="">Select…</option>
                {(Object.keys(TRANSMISSION_LABEL) as (keyof typeof TRANSMISSION_LABEL)[]).map(
                  (t) => (
                    <option key={t} value={t}>
                      {TRANSMISSION_LABEL[t]}
                    </option>
                  ),
                )}
              </select>
            </FormField>
          ) : null}
          {show('fuelType') ? (
            <FormField id="fuelType" label={`Fuel${req('fuelType')}`} error={errors.fuelType}>
              <select
                id="fuelType"
                className={selectClass}
                value={form.fuelType}
                disabled={identityLocked}
                onChange={(e) => update('fuelType', e.target.value as VehicleFormState['fuelType'])}
              >
                <option value="">Select…</option>
                {(Object.keys(FUEL_LABEL) as (keyof typeof FUEL_LABEL)[]).map((f) => (
                  <option key={f} value={f}>
                    {FUEL_LABEL[f]}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          {show('seats') ? (
            <FormField id="seats" label={`Seats${req('seats')}`} error={errors.seats}>
              <Input
                id="seats"
                type="number"
                value={form.seats}
                disabled={identityLocked}
                onChange={(e) => update('seats', e.target.value)}
              />
            </FormField>
          ) : null}
          {show('doors') ? (
            <FormField id="doors" label={`Doors${req('doors')}`} error={errors.doors}>
              <Input
                id="doors"
                type="number"
                value={form.doors}
                disabled={identityLocked}
                onChange={(e) => update('doors', e.target.value)}
              />
            </FormField>
          ) : null}
          {show('engineCc') ? (
            <FormField
              id="engineCc"
              label={`Engine (cc)${req('engineCc')}`}
              error={errors.engineCc}
            >
              <Input
                id="engineCc"
                type="number"
                value={form.engineCc}
                disabled={identityLocked}
                onChange={(e) => update('engineCc', e.target.value)}
              />
            </FormField>
          ) : null}
          {show('luggageCapacity') ? (
            <FormField
              id="luggageCapacity"
              label="Luggage (bags, optional)"
              error={errors.luggageCapacity}
            >
              <Input
                id="luggageCapacity"
                type="number"
                value={form.luggageCapacity}
                disabled={identityLocked}
                onChange={(e) => update('luggageCapacity', e.target.value)}
              />
            </FormField>
          ) : null}
          {show('hasAc') ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={form.hasAc}
                disabled={identityLocked}
                onCheckedChange={(checked) => update('hasAc', checked === true)}
              />
              <span>Air conditioning</span>
            </label>
          ) : null}
        </div>
      </AuthCard>

      <AuthCard
        title="Pricing (LKR)"
        description="Transparent prices customers will see. Whole rupees or two decimals; no hidden extras."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="dailyRate"
            label="Daily rate *"
            error={errors.dailyRate}
            hint="500 – 1,000,000"
          >
            <Input
              id="dailyRate"
              inputMode="decimal"
              value={form.dailyRate}
              disabled={readOnly}
              onChange={(e) => update('dailyRate', e.target.value)}
            />
          </FormField>
          <FormField
            id="securityDeposit"
            label="Refundable deposit *"
            error={errors.securityDeposit}
            hint="0 if none"
          >
            <Input
              id="securityDeposit"
              inputMode="decimal"
              value={form.securityDeposit}
              disabled={readOnly}
              onChange={(e) => update('securityDeposit', e.target.value)}
            />
          </FormField>
          <FormField
            id="weeklyRate"
            label="Weekly price (optional)"
            error={errors.weeklyRate}
            hint="Between 1× and 7× the daily rate"
          >
            <Input
              id="weeklyRate"
              inputMode="decimal"
              value={form.weeklyRate}
              disabled={readOnly}
              onChange={(e) => update('weeklyRate', e.target.value)}
            />
          </FormField>
          <FormField
            id="monthlyRate"
            label="Monthly price (optional)"
            error={errors.monthlyRate}
            hint="At most 30× the daily rate"
          >
            <Input
              id="monthlyRate"
              inputMode="decimal"
              value={form.monthlyRate}
              disabled={readOnly}
              onChange={(e) => update('monthlyRate', e.target.value)}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.unlimitedKm}
              disabled={readOnly}
              onCheckedChange={(checked) => update('unlimitedKm', checked === true)}
            />
            <span>Unlimited kilometres</span>
          </label>
          {!form.unlimitedKm ? (
            <>
              <FormField
                id="includedKmPerDay"
                label="Included km per day"
                error={errors.includedKmPerDay}
              >
                <Input
                  id="includedKmPerDay"
                  type="number"
                  value={form.includedKmPerDay}
                  disabled={readOnly}
                  onChange={(e) => update('includedKmPerDay', e.target.value)}
                />
              </FormField>
              <FormField id="extraKmRate" label="Extra km price (LKR)" error={errors.extraKmRate}>
                <Input
                  id="extraKmRate"
                  inputMode="decimal"
                  value={form.extraKmRate}
                  disabled={readOnly}
                  onChange={(e) => update('extraKmRate', e.target.value)}
                />
              </FormField>
            </>
          ) : null}
          <FormField id="minRentalDays" label="Minimum rental days *" error={errors.minRentalDays}>
            <Input
              id="minRentalDays"
              type="number"
              min={1}
              value={form.minRentalDays}
              disabled={readOnly}
              onChange={(e) => update('minRentalDays', e.target.value)}
            />
          </FormField>
          <FormField
            id="maxRentalDays"
            label="Maximum rental days (optional)"
            error={errors.maxRentalDays}
          >
            <Input
              id="maxRentalDays"
              type="number"
              value={form.maxRentalDays}
              disabled={readOnly}
              onChange={(e) => update('maxRentalDays', e.target.value)}
            />
          </FormField>
        </div>
        {form.dailyRate ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Preview: {formatLkr(/^\d+(\.\d{1,2})?$/.test(form.dailyRate) ? form.dailyRate : null)}{' '}
            per day
            {form.securityDeposit && /^\d+(\.\d{1,2})?$/.test(form.securityDeposit)
              ? ` · deposit ${formatLkr(form.securityDeposit)}`
              : ''}
          </p>
        ) : null}
      </AuthCard>

      <AuthCard title="Rental rules & pickup">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="minRenterAge"
            label="Minimum renter age (optional)"
            error={errors.minRenterAge}
          >
            <Input
              id="minRenterAge"
              type="number"
              value={form.minRenterAge}
              disabled={readOnly}
              onChange={(e) => update('minRenterAge', e.target.value)}
            />
          </FormField>
          <FormField
            id="minLicenceYears"
            label="Minimum licence years (optional)"
            error={errors.minLicenceYears}
          >
            <Input
              id="minLicenceYears"
              type="number"
              value={form.minLicenceYears}
              disabled={readOnly}
              onChange={(e) => update('minLicenceYears', e.target.value)}
            />
          </FormField>
          <FormField id="fuelPolicy" label="Fuel policy (optional)" error={errors.fuelPolicy}>
            <select
              id="fuelPolicy"
              className={selectClass}
              value={form.fuelPolicy}
              disabled={readOnly}
              onChange={(e) =>
                update('fuelPolicy', e.target.value as VehicleFormState['fuelPolicy'])
              }
            >
              <option value="">Not specified</option>
              {(Object.keys(FUEL_POLICY_LABEL) as (keyof typeof FUEL_POLICY_LABEL)[]).map((p) => (
                <option key={p} value={p}>
                  {FUEL_POLICY_LABEL[p]}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.deliveryAvailable}
                disabled={readOnly}
                onCheckedChange={(checked) => update('deliveryAvailable', checked === true)}
              />
              <span>Delivery to the customer available</span>
            </label>
            {form.deliveryAvailable ? (
              <FormField
                id="deliveryFee"
                label="Delivery fee (LKR, blank = on request)"
                error={errors.deliveryFee}
              >
                <Input
                  id="deliveryFee"
                  inputMode="decimal"
                  value={form.deliveryFee}
                  disabled={readOnly}
                  onChange={(e) => update('deliveryFee', e.target.value)}
                />
              </FormField>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <FormField
              id="pickupNotes"
              label="Pickup / drop-off notes (optional)"
              error={errors.pickupNotes}
            >
              <Textarea
                id="pickupNotes"
                className="min-h-14"
                value={form.pickupNotes}
                disabled={readOnly}
                onChange={(e) => update('pickupNotes', e.target.value)}
              />
            </FormField>
          </div>
        </div>
      </AuthCard>

      {!readOnly ? (
        <AuthCard title={vehicle.editable === 'all' ? 'Save and submit' : 'Save changes'}>
          <div className="grid gap-4">
            {vehicle.editable === 'all' && checklist.length > 0 ? (
              <div className="text-sm">
                <p className="font-medium">Before you can submit:</p>
                <ul className="text-muted-foreground mt-1 list-disc pl-5">
                  {checklist.map((i) => (
                    <li key={`${i.field}-${i.issue}`}>
                      {i.field ? <span className="font-medium">{i.field}: </span> : null}
                      {i.issue}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void save(false)}
              >
                {busy === 'save' ? 'Saving…' : 'Save'}
              </Button>
              {vehicle.editable === 'all' ? (
                <Button type="submit" disabled={busy !== null}>
                  {busy === 'submit'
                    ? 'Submitting…'
                    : vehicle.status === 'changes_requested'
                      ? 'Save and resubmit'
                      : 'Save and submit for review'}
                </Button>
              ) : null}
            </div>
            {vehicle.editable === 'all' ? (
              <p className="text-muted-foreground text-xs">
                Submitting saves your changes first. Our team reviews every listing manually.
              </p>
            ) : null}
          </div>
        </AuthCard>
      ) : null}
    </form>
  );
}
