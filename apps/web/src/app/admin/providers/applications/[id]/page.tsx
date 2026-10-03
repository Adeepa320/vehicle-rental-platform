'use client';

import type { AdminProviderApplication } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { submitErrorFrom } from '@/lib/forms';
import { APPLICATION_STATUS, PROVIDER_TYPE_LABEL, formatDate } from '@/lib/provider-labels';
import { categoryName, districtName, placeName, useReferenceData } from '@/lib/reference';

export default function AdminApplicationDetailPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const reference = useReferenceData();
  const [application, setApplication] = useState<AdminProviderApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  useEffect(() => {
    if (gate !== 'ready' || !isAdmin || !params.id) return;
    let cancelled = false;
    withAccessToken((token) => api.admin.getApplication(token, params.id))
      .then((result) => {
        if (!cancelled) setApplication(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, isAdmin, params.id, withAccessToken]);

  if (gate !== 'ready') {
    return <Shell>Loading…</Shell>;
  }
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
  if (!application) return <Shell>Loading application…</Shell>;

  const ref = reference.status === 'ready' ? reference.data : undefined;
  const meta = APPLICATION_STATUS[application.status];
  const canStart = application.status === 'submitted';
  const canDecide = application.status === 'submitted' || application.status === 'under_review';

  const run = async (action: () => Promise<AdminProviderApplication>) => {
    setBusy(true);
    setError(null);
    try {
      setApplication(await action());
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string][] = [
    ['Business', application.displayName ?? '—'],
    ['Type', application.providerType ? PROVIDER_TYPE_LABEL[application.providerType] : '—'],
    ['Contact person', application.contactName ?? '—'],
    ['Phone', `${application.phone ?? '—'} (not verified; confirm by calling)`],
    ['WhatsApp', application.whatsapp ?? '—'],
    ['District', districtName(ref, application.districtId)],
    ['Primary place', placeName(ref, application.primaryPlaceId)],
    [
      'Service areas',
      application.serviceAreaPlaceIds.map((id) => placeName(ref, id)).join(', ') || '—',
    ],
    ['Address', application.addressText ?? '—'],
    [
      'Vehicle types',
      application.vehicleCategoryIds.map((id) => categoryName(ref, id)).join(', ') || '—',
    ],
    [
      'Years operating',
      application.yearsOperating === null ? '—' : String(application.yearsOperating),
    ],
    [
      'Fleet estimate',
      application.fleetSizeEstimate === null ? '—' : String(application.fleetSizeEstimate),
    ],
    [
      'Delivery / airport',
      `${application.offersDelivery ? 'delivery' : 'no delivery'} · ${application.offersAirportTransfer ? 'airport transfers' : 'no airport transfers'}`,
    ],
    ['Website', application.websiteUrl ?? '—'],
    [
      'Agreement',
      application.agreementAcceptedAt
        ? `${application.agreementVersion} accepted ${formatDate(application.agreementAcceptedAt)}`
        : 'not accepted',
    ],
  ];

  return (
    <Shell>
      <Link
        href="/admin/providers"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← Back to provider review
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {application.displayName ?? 'Untitled application'}
          </h1>
          <Badge variant={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Applicant {application.applicant.fullName} · {application.applicant.email}
          {application.applicant.emailVerified ? ' (e-mail verified)' : ' (e-mail NOT verified)'} ·
          member since {formatDate(application.applicant.memberSince)}
        </p>
        <p className="text-muted-foreground text-xs">
          Submitted {formatDate(application.submittedAt)} · Review started{' '}
          {formatDate(application.reviewStartedAt)} · Last decision{' '}
          {formatDate(application.reviewedAt)}
        </p>
      </header>

      {application.reviewReason ? (
        <FormMessage variant="destructive" title="Last message to applicant">
          <p className="whitespace-pre-wrap">{application.reviewReason}</p>
        </FormMessage>
      ) : null}

      <AuthCard title="Application">
        <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {application.description ? (
          <p className="mt-4 text-sm whitespace-pre-wrap">{application.description}</p>
        ) : null}
        {application.applicantNotes ? (
          <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
            Applicant notes: {application.applicantNotes}
          </p>
        ) : null}
      </AuthCard>

      <AuthCard title="Internal notes" description="Visible to admins only.">
        <p className="text-sm whitespace-pre-wrap">{application.adminNotes ?? '—'}</p>
      </AuthCard>

      <AuthCard
        title="Decision"
        description="Confirm the contact details and operating area with the applicant before approving. Approval grants the provider role and creates the profile immediately."
      >
        {canDecide ? (
          <div className="flex flex-wrap gap-3">
            {canStart ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(() => withAccessToken((t) => api.admin.startReview(t, application.id)))
                }
              >
                Start review
              </Button>
            ) : null}
            <ReasonAction
              label="Request changes"
              confirmLabel="Send to applicant"
              variant="outline"
              placeholder="What must the applicant change? (shown to the applicant)"
              onConfirm={async (reason) =>
                run(() =>
                  withAccessToken((t) => api.admin.requestChanges(t, application.id, reason)),
                )
              }
            />
            <ReasonAction
              label="Approve"
              confirmLabel="Approve provider"
              variant="default"
              optional
              placeholder="Internal note (optional), e.g. how you verified the applicant"
              onConfirm={async (notes) =>
                run(() =>
                  withAccessToken((t) => api.admin.approve(t, application.id, notes || undefined)),
                )
              }
            />
            <ReasonAction
              label="Reject"
              confirmLabel="Reject application"
              variant="destructive"
              placeholder="Reason (shown to the applicant)"
              onConfirm={async (reason) =>
                run(() => withAccessToken((t) => api.admin.reject(t, application.id, reason)))
              }
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {application.status === 'approved'
              ? 'Approved. Manage the provider from the Approved providers tab.'
              : application.status === 'rejected'
                ? 'Rejected (terminal).'
                : 'Waiting for the applicant to resubmit.'}
          </p>
        )}
      </AuthCard>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">{children}</main>
  );
}
