'use client';

import {
  CreateAvailabilityBlockRequestSchema,
  type BlockReason,
  type Vehicle,
  type VehicleAvailability,
  type VehicleHold,
} from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import {
  BLOCK_REASON_LABEL,
  VEHICLE_STATUS,
  colomboDateToInstant,
  formatDay,
  instantToColomboDate,
  todayInColombo,
  vehicleTitle,
} from '@/lib/vehicle-labels';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

/** `YYYY-MM-DD` plus n days (calendar arithmetic in UTC on the date part only). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Block form → API payload: the end date is inclusive in the UI, exclusive in the API. */
export function toBlockPayload(form: {
  startDate: string;
  endDate: string;
  reason: string;
  note: string;
}) {
  return {
    startsAt: form.startDate ? colomboDateToInstant(form.startDate) : '',
    endsAt: form.endDate ? colomboDateToInstant(addDays(form.endDate, 1)) : '',
    reason: form.reason,
    note: form.note.trim() === '' ? null : form.note.trim(),
  };
}

export default function VehicleAvailabilityPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [holds, setHolds] = useState<VehicleHold[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (area.status !== 'ready' || !params.id) return;
    let cancelled = false;
    Promise.all([
      withAccessToken((t) => api.vehicles.get(t, params.id)),
      withAccessToken((t) => api.vehicles.blocks(t, params.id)),
    ])
      .then(([v, h]) => {
        if (cancelled) return;
        setVehicle(v);
        setHolds(h);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, params.id, withAccessToken]);

  if (area.status === 'error' || error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive">
          {area.status === 'error' ? area.message : error}
        </FormMessage>
      </main>
    );
  }
  if (area.status !== 'ready' || !vehicle || holds === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading availability…</p>
      </main>
    );
  }

  const meta = VEHICLE_STATUS[vehicle.status];
  const canManage =
    (vehicle.status === 'approved' || vehicle.status === 'inactive') &&
    area.profile.status === 'active';
  const title = vehicleTitle(vehicle);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <Link
        href={`/provider/vehicles/${vehicle.id}`}
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← Back to {title}
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Availability</h1>
          <Badge variant={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {vehicle.status === 'approved'
            ? 'Available on every day you have not blocked. Customer bookings will appear here in a later release.'
            : vehicle.status === 'inactive'
              ? 'The listing is offline; blocks are kept for when you put it back online.'
              : 'Availability can be managed once the listing is approved.'}
        </p>
      </header>

      <DayStrip holds={holds} />

      {canManage ? (
        <BlockEditor
          vehicleId={vehicle.id}
          onCreated={(hold) =>
            setHolds((c) =>
              [...(c ?? []), hold].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
            )
          }
        />
      ) : null}

      <AuthCard
        title="Blocked periods"
        description="Current and upcoming. Dates are in Sri Lanka time."
      >
        {holds.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No blocks. The vehicle is available on all days.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {holds.map((hold) => (
              <li
                key={hold.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">
                    {formatDay(hold.startsAt)} →{' '}
                    {formatDay(new Date(new Date(hold.endsAt).getTime() - 1).toISOString())}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {hold.kind === 'block' && hold.reason
                      ? BLOCK_REASON_LABEL[hold.reason]
                      : hold.kind}
                    {hold.note ? ` · ${hold.note}` : ''}
                  </p>
                </div>
                {canManage && hold.kind === 'block' ? (
                  <DeleteBlockButton
                    vehicleId={vehicle.id}
                    hold={hold}
                    onDeleted={() => setHolds((c) => (c ?? []).filter((h) => h.id !== hold.id))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AuthCard>

      <WindowCheck vehicleId={vehicle.id} />
    </main>
  );
}

/** Eight weeks of days; blocked days are shaded. */
function DayStrip({ holds }: { holds: VehicleHold[] }) {
  const start = todayInColombo();
  const days = Array.from({ length: 56 }, (_, i) => addDays(start, i));
  const blocked = new Set<string>();
  for (const hold of holds) {
    let day = instantToColomboDate(hold.startsAt);
    const endExclusive = instantToColomboDate(
      new Date(new Date(hold.endsAt).getTime() - 1).toISOString(),
    );
    let guard = 0;
    while (day <= endExclusive && guard < 400) {
      blocked.add(day);
      day = addDays(day, 1);
      guard += 1;
    }
  }
  return (
    <AuthCard title="Next 8 weeks" description="Grey days are blocked.">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] sm:grid-cols-14">
        {days.map((day) => (
          <div
            key={day}
            title={day}
            className={`rounded px-0.5 py-1 ${blocked.has(day) ? 'bg-muted-foreground/60 text-background' : 'bg-muted'}`}
          >
            {Number(day.slice(8, 10))}
          </div>
        ))}
      </div>
    </AuthCard>
  );
}

function BlockEditor({
  vehicleId,
  onCreated,
}: {
  vehicleId: string;
  onCreated: (hold: VehicleHold) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [form, setForm] = useState({
    startDate: todayInColombo(),
    endDate: todayInColombo(),
    reason: 'maintenance' as BlockReason,
    note: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = CreateAvailabilityBlockRequestSchema.safeParse(toBlockPayload(form));
    if (!parsed.success) {
      const fieldErrors = fieldErrorsFromZod(parsed.error);
      setErrors({
        startDate: fieldErrors.startsAt ?? '',
        endDate: fieldErrors.endsAt ?? '',
        reason: fieldErrors.reason ?? '',
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onCreated(await withAccessToken((t) => api.vehicles.createBlock(t, vehicleId, parsed.data)));
      setForm((c) => ({ ...c, note: '' }));
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setMessage(
        failure.code === 'AVAILABILITY_CONFLICT'
          ? `${failure.message} ${failure.fields.startsAt ?? ''}`.trim()
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Block dates"
      description="Mark days the vehicle cannot be rented. The end date is included."
    >
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="startDate" label="From" error={errors.startDate || undefined}>
            <Input
              id="startDate"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((c) => ({ ...c, startDate: e.target.value }))}
            />
          </FormField>
          <FormField id="endDate" label="To (inclusive)" error={errors.endDate || undefined}>
            <Input
              id="endDate"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((c) => ({ ...c, endDate: e.target.value }))}
            />
          </FormField>
          <FormField id="reason" label="Reason" error={errors.reason || undefined}>
            <select
              id="reason"
              className={selectClass}
              value={form.reason}
              onChange={(e) => setForm((c) => ({ ...c, reason: e.target.value as BlockReason }))}
            >
              {(Object.keys(BLOCK_REASON_LABEL) as BlockReason[]).map((r) => (
                <option key={r} value={r}>
                  {BLOCK_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField id="note" label="Internal note (optional)">
          <Textarea
            id="note"
            className="min-h-12"
            value={form.note}
            onChange={(e) => setForm((c) => ({ ...c, note: e.target.value }))}
          />
        </FormField>
        <Button type="submit" disabled={busy}>
          {busy ? 'Blocking…' : 'Block these days'}
        </Button>
      </form>
    </AuthCard>
  );
}

function DeleteBlockButton({
  vehicleId,
  hold,
  onDeleted,
}: {
  vehicleId: string;
  hold: VehicleHold;
  onDeleted: () => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await withAccessToken((t) => api.vehicles.deleteBlock(t, vehicleId, hold.id));
          onDeleted();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Removing…' : 'Remove'}
    </Button>
  );
}

function WindowCheck({ vehicleId }: { vehicleId: string }) {
  const { api, withAccessToken } = useAuth();
  const [from, setFrom] = useState(todayInColombo());
  const [to, setTo] = useState(addDays(todayInColombo(), 3));
  const [result, setResult] = useState<VehicleAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard
      title="Check a window"
      description="What a customer would see for a pickup/return date pair."
    >
      <form
        className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            setResult(
              await withAccessToken((t) =>
                api.vehicles.availability(
                  t,
                  vehicleId,
                  colomboDateToInstant(from),
                  colomboDateToInstant(to),
                ),
              ),
            );
          } catch (caught) {
            setError(submitErrorFrom(caught).message);
          }
        }}
      >
        <FormField id="from" label="Pickup">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField id="to" label="Return">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" variant="outline">
            Check
          </Button>
        </div>
      </form>
      {error ? <p className="text-destructive mt-3 text-xs">{error}</p> : null}
      {result ? (
        <p className="mt-3 text-sm">
          {result.available ? (
            <Badge>Available</Badge>
          ) : (
            <Badge variant="destructive">
              {result.bookable
                ? 'Blocked in this window'
                : `Not bookable (${VEHICLE_STATUS[result.status].label})`}
            </Badge>
          )}{' '}
          {formatDay(result.from)} → {formatDay(result.to)}
          {result.holds.length > 0
            ? ` · ${result.holds.length} overlapping block${result.holds.length === 1 ? '' : 's'}`
            : ''}
        </p>
      ) : null}
    </AuthCard>
  );
}
