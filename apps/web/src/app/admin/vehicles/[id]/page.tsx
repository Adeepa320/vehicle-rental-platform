'use client';

import { formatLkr, type AdminVehicle } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { submitErrorFrom } from '@/lib/forms';
import { formatDate } from '@/lib/provider-labels';
import { categoryName, districtName, placeName, useReferenceData } from '@/lib/reference';
import {
  FUEL_LABEL,
  FUEL_POLICY_LABEL,
  TRANSMISSION_LABEL,
  VEHICLE_STATUS,
  vehicleTitle,
} from '@/lib/vehicle-labels';

export default function AdminVehicleDetailPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const reference = useReferenceData();
  const [vehicle, setVehicle] = useState<AdminVehicle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  useEffect(() => {
    if (gate !== 'ready' || !isAdmin || !params.id) return;
    let cancelled = false;
    withAccessToken((token) => api.admin.getVehicle(token, params.id))
      .then((result) => {
        if (!cancelled) setVehicle(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, isAdmin, params.id, withAccessToken]);

  if (gate !== 'ready') return <Shell>Loading…</Shell>;
  if (!isAdmin) {
    return (
      <Shell>
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <FormMessage variant="destructive">{error}</FormMessage>
      </Shell>
    );
  }
  if (!vehicle) return <Shell>Loading listing…</Shell>;

  const ref = reference.status === 'ready' ? reference.data : undefined;
  const meta = VEHICLE_STATUS[vehicle.status];
  const title = vehicleTitle(vehicle, 'Untitled listing');
  const canStart = vehicle.status === 'submitted';
  const canDecide = vehicle.status === 'submitted' || vehicle.status === 'under_review';
  const canSuspend = vehicle.status === 'approved' || vehicle.status === 'inactive';
  const canReactivate = vehicle.status === 'suspended';

  const run = async (action: () => Promise<AdminVehicle>) => {
    setBusy(true);
    setError(null);
    try {
      setVehicle(await action());
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  };
  const act = (
    action: 'start-review' | 'request-changes' | 'approve' | 'reject' | 'suspend' | 'reactivate',
    body: { reason?: string; adminNotes?: string; note?: string } = {},
  ) => run(() => withAccessToken((t) => api.admin.vehicleAction(t, vehicle.id, action, body)));

  const dash = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === '' ? '—' : String(v);
  const details: [string, string][] = [
    ['Category', categoryName(ref, vehicle.categoryId)],
    [
      'Make / model / year',
      `${dash(vehicle.make)} ${dash(vehicle.model)} ${dash(vehicle.modelYear)}`,
    ],
    [
      'Registration number',
      `${dash(vehicle.registrationNumber)} (full plate; never shown to customers)`,
    ],
    [
      'Transmission / fuel',
      `${vehicle.transmission ? TRANSMISSION_LABEL[vehicle.transmission] : '—'} / ${vehicle.fuelType ? FUEL_LABEL[vehicle.fuelType] : '—'}`,
    ],
    [
      'Seats / doors / luggage',
      `${dash(vehicle.seats)} / ${dash(vehicle.doors)} / ${dash(vehicle.luggageCapacity)}`,
    ],
    [
      'Engine / AC / colour',
      `${vehicle.engineCc ? `${vehicle.engineCc} cc` : '—'} / ${vehicle.hasAc ? 'AC' : 'no AC'} / ${dash(vehicle.color)}`,
    ],
    ['Internal reference', dash(vehicle.internalName)],
  ];
  const pricing: [string, string][] = [
    ['Daily rate', formatLkr(vehicle.dailyRate)],
    ['Weekly / monthly', `${formatLkr(vehicle.weeklyRate)} / ${formatLkr(vehicle.monthlyRate)}`],
    ['Deposit', formatLkr(vehicle.securityDeposit)],
    [
      'Kilometres',
      vehicle.includedKmPerDay === null
        ? 'Unlimited'
        : `${vehicle.includedKmPerDay} km/day, extra ${formatLkr(vehicle.extraKmRate)}/km`,
    ],
    ['Rental length', `${vehicle.minRentalDays}–${vehicle.maxRentalDays ?? '∞'} days`],
    [
      'Renter requirements',
      `age ≥ ${dash(vehicle.minRenterAge)}, licence ≥ ${dash(vehicle.minLicenceYears)} years`,
    ],
    ['Fuel policy', vehicle.fuelPolicy ? FUEL_POLICY_LABEL[vehicle.fuelPolicy] : '—'],
    [
      'Delivery',
      vehicle.deliveryAvailable
        ? `available${vehicle.deliveryFee ? `, ${formatLkr(vehicle.deliveryFee)}` : ', price on request'}`
        : 'not offered',
    ],
  ];

  return (
    <Shell>
      <AdminNav />
      <Link
        href="/admin/vehicles"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← Back to vehicle review
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <Badge variant={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Provider{' '}
          <span className="text-foreground font-medium">{vehicle.provider.displayName}</span> (
          {vehicle.provider.status}) · {vehicle.provider.owner.fullName} ·{' '}
          {vehicle.provider.owner.email}
        </p>
        <p className="text-muted-foreground text-xs">
          Submitted {formatDate(vehicle.submittedAt)} · Review started{' '}
          {formatDate(vehicle.reviewStartedAt)} · Last decision {formatDate(vehicle.reviewedAt)}
        </p>
      </header>

      {vehicle.reviewReason ? (
        <FormMessage variant="destructive" title="Last message to the provider">
          <p className="whitespace-pre-wrap">{vehicle.reviewReason}</p>
        </FormMessage>
      ) : null}
      {vehicle.suspensionReason ? (
        <FormMessage variant="destructive" title="Suspension reason">
          <p className="whitespace-pre-wrap">{vehicle.suspensionReason}</p>
        </FormMessage>
      ) : null}
      {vehicle.submissionIssues.length > 0 ? (
        <FormMessage variant="destructive" title="Listing is currently incomplete">
          <ul className="list-disc pl-5">
            {vehicle.submissionIssues.map((i) => (
              <li key={`${i.field}-${i.issue}`}>
                {i.field ? `${i.field}: ` : ''}
                {i.issue}
              </li>
            ))}
          </ul>
        </FormMessage>
      ) : null}

      <AuthCard title="Vehicle">
        <Rows rows={details} />
        {vehicle.description ? (
          <p className="mt-4 text-sm whitespace-pre-wrap">{vehicle.description}</p>
        ) : null}
      </AuthCard>

      <AuthCard title="Pricing & rules (LKR)">
        <Rows rows={pricing} />
        {vehicle.pickupNotes ? (
          <p className="text-muted-foreground mt-3 text-sm whitespace-pre-wrap">
            Pickup notes: {vehicle.pickupNotes}
          </p>
        ) : null}
      </AuthCard>

      <AuthCard title="Pickup location">
        {vehicle.location ? (
          <Rows
            rows={[
              [
                'Name',
                `${vehicle.location.name}${vehicle.location.isPrimary ? ' (primary)' : ''}${vehicle.location.isActive ? '' : ' (INACTIVE)'}`,
              ],
              [
                'Place',
                `${placeName(ref, vehicle.location.placeId)}, ${districtName(ref, vehicle.location.districtId)}`,
              ],
              ['Address', vehicle.location.addressText],
              [
                'Pin',
                vehicle.location.point
                  ? `${vehicle.location.point.lat}, ${vehicle.location.point.lng}`
                  : 'none',
              ],
              ['Pickup instructions', vehicle.location.pickupInstructions ?? '—'],
            ]}
          />
        ) : (
          <p className="text-muted-foreground text-sm">No pickup location set.</p>
        )}
      </AuthCard>

      <AuthCard title="Internal notes" description="Visible to admins only.">
        <p className="text-sm whitespace-pre-wrap">{vehicle.adminNotes ?? '—'}</p>
      </AuthCard>

      <AuthCard
        title="Decision"
        description="Approval makes the listing available (unless the provider blocks dates). Suspension removes it until reactivated."
      >
        <div className="flex flex-wrap gap-3">
          {canStart ? (
            <Button variant="outline" disabled={busy} onClick={() => void act('start-review')}>
              Start review
            </Button>
          ) : null}
          {canDecide ? (
            <>
              <ReasonAction
                label="Request changes"
                confirmLabel="Send to provider"
                variant="outline"
                placeholder="What must the provider change? (shown to the provider)"
                onConfirm={(reason) => act('request-changes', { reason })}
              />
              <ReasonAction
                label="Approve"
                confirmLabel="Approve listing"
                variant="default"
                optional
                placeholder="Internal note (optional), e.g. how you verified the vehicle"
                onConfirm={(notes) => act('approve', { adminNotes: notes || undefined })}
              />
              <ReasonAction
                label="Reject"
                confirmLabel="Reject listing"
                variant="destructive"
                placeholder="Reason (shown to the provider)"
                onConfirm={(reason) => act('reject', { reason })}
              />
            </>
          ) : null}
          {canSuspend ? (
            <ReasonAction
              label="Suspend listing"
              confirmLabel="Suspend"
              variant="destructive"
              placeholder="Reason (shown to the provider)"
              onConfirm={(reason) => act('suspend', { reason })}
            />
          ) : null}
          {canReactivate ? (
            <ReasonAction
              label="Reactivate listing"
              confirmLabel="Reactivate"
              variant="default"
              optional
              placeholder="Internal note (optional)"
              onConfirm={(note) => act('reactivate', { note: note || undefined })}
            />
          ) : null}
          {!canStart && !canDecide && !canSuspend && !canReactivate ? (
            <p className="text-muted-foreground text-sm">
              {vehicle.status === 'rejected' ? 'Rejected (terminal).' : 'Waiting for the provider.'}
            </p>
          ) : null}
        </div>
      </AuthCard>
    </Shell>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[200px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">{children}</main>
  );
}
