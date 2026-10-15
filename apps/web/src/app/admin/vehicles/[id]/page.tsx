'use client';

import {
  PROTECTED_CATEGORY_REASON,
  PROTECTED_INACTIVE_CATEGORY_IDS,
  formatLkr,
  type AdminVehicle,
} from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { selectClass } from '@/components/admin/admin-shell';
import { ReasonAction } from '@/components/admin/reason-action';
import { Photo } from '@/components/public/photo';
import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DOCUMENT_TYPE_LABEL } from '@/lib/admin-labels';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDate } from '@/lib/provider-labels';
import {
  categoryName,
  districtName,
  placeName,
  useReferenceData,
  type ReferenceData,
} from '@/lib/reference';
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
          <Link
            href={`/admin/providers/${vehicle.provider.id}`}
            className="text-foreground font-medium underline underline-offset-4"
          >
            {vehicle.provider.displayName}
          </Link>{' '}
          ({vehicle.provider.status}) · {vehicle.provider.owner.fullName} ·{' '}
          {vehicle.provider.owner.email}
        </p>
        <p className="text-muted-foreground text-xs">
          Submitted {formatDate(vehicle.submittedAt)} · Review started{' '}
          {formatDate(vehicle.reviewStartedAt)} · Last decision {formatDate(vehicle.reviewedAt)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/admin/documents?vehicleId=${vehicle.id}`} />}
          >
            Documents
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/admin/bookings?vehicleId=${vehicle.id}`} />}
          >
            Bookings
          </Button>
        </div>
      </header>

      <OperationsCard vehicle={vehicle} />

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

      <AuthCard
        title={`Photos (${vehicle.photos.length})`}
        description="Exactly what customers will see; metadata is stripped at upload. Removing a photo is audited and the provider is told why."
      >
        {vehicle.photos.length === 0 ? (
          <p className="text-muted-foreground text-sm">No photos uploaded.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {vehicle.photos.map((photo, index) => (
              <li key={photo.id} className="grid gap-1">
                <Photo
                  src={photo.variants.medium}
                  alt={`Photo ${index + 1}`}
                  className="aspect-[4/3] w-full"
                />
                <span className="text-muted-foreground text-xs">
                  {photo.isPrimary ? 'Primary · ' : ''}
                  {photo.width}×{photo.height}
                </span>
                <ReasonAction
                  label="Remove"
                  confirmLabel="Remove photo"
                  variant="destructive"
                  placeholder="Reason (shown to the provider, 5–500 characters)"
                  onConfirm={(reason) =>
                    run(() =>
                      withAccessToken((t) =>
                        api.admin.removeVehiclePhoto(t, vehicle.id, photo.id, { reason }),
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </AuthCard>

      <AuthCard
        title="Category"
        description="Move a mis-categorised listing to another active category. The provider is told the reason; pricing and documents are unchanged."
      >
        <p className="mb-3 text-sm">
          Currently <span className="font-medium">{categoryName(ref, vehicle.categoryId)}</span>.
        </p>
        <CorrectCategoryForm
          vehicle={vehicle}
          reference={ref}
          busy={busy}
          onSubmit={(categoryId, reason) =>
            run(() =>
              withAccessToken((t) =>
                api.admin.correctVehicleCategory(t, vehicle.id, { categoryId, reason }),
              ),
            )
          }
        />
      </AuthCard>

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

function OperationsCard({ vehicle }: { vehicle: AdminVehicle }) {
  const ops = vehicle.operations;
  const docs = ops.documents;
  const list = (types: readonly (keyof typeof DOCUMENT_TYPE_LABEL)[]) =>
    types.length === 0 ? 'none' : types.map((t) => DOCUMENT_TYPE_LABEL[t]).join(', ');
  return (
    <AuthCard
      title="Operations"
      description="Why the listing is (not) visible to customers right now."
    >
      <Rows
        rows={[
          [
            'Publicly searchable',
            ops.publiclySearchable
              ? 'Yes'
              : `No — ${ops.searchabilityIssues.join('; ') || 'see status'}`,
          ],
          ['Photos', `${ops.photoCount} of at least ${ops.minimumPhotos} required`],
          [
            'Documents',
            docs.verified
              ? 'Verified vehicle: registration, revenue licence and insurance approved and in date'
              : `Not verified · missing: ${list(docs.missing)} · expired: ${list(docs.expired)} · pending: ${list(docs.pending)}`,
          ],
          ['Open bookings', String(ops.openBookings)],
          [
            'Auto-paused',
            ops.autoPausedAt
              ? `${formatDateTime(ops.autoPausedAt)} by the document-expiry sweep`
              : 'No',
          ],
          ['Suspension reason', ops.suspensionReason ?? '—'],
        ]}
      />
    </AuthCard>
  );
}

function CorrectCategoryForm({
  vehicle,
  reference,
  busy,
  onSubmit,
}: {
  vehicle: AdminVehicle;
  reference: ReferenceData | undefined;
  busy: boolean;
  onSubmit: (categoryId: string, reason: string) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const options = (reference?.categories ?? []).filter((c) => c.id !== vehicle.categoryId);
  const valid = categoryId !== '' && reason.trim().length >= 5;
  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        await onSubmit(categoryId, reason.trim());
        setCategoryId('');
        setReason('');
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="new-category" label="New category (active categories only)">
          <select
            id="new-category"
            className={`${selectClass} w-full`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Choose…</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="category-reason" label="Reason (shown to the provider)">
          <Textarea
            id="category-reason"
            className="min-h-9"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      </div>
      <p className="text-muted-foreground text-xs">
        {PROTECTED_INACTIVE_CATEGORY_IDS.join(' and ')} are intentionally inactive and cannot be
        chosen: {PROTECTED_CATEGORY_REASON}
      </p>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={busy || !valid}>
          Move to this category
        </Button>
      </div>
    </form>
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
