'use client';

import type { AdminProviderDetail } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminShell, DetailRows } from '@/components/admin/admin-shell';
import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { ProviderMetricsList } from '@/components/provider/provider-metrics-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DOCUMENT_TYPE_LABEL, USER_STATUS } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { PROVIDER_STATUS, PROVIDER_TYPE_LABEL } from '@/lib/provider-labels';
import { categoryName, districtName, placeName, useReferenceData } from '@/lib/reference';

export default function AdminProviderDetailPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const params = useParams<{ id: string }>();
  const reference = useReferenceData();
  const [provider, setProvider] = useState<AdminProviderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.getProvider(t, params.id))
      .then((result) => {
        if (!cancelled) setProvider(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, params.id, ready, withAccessToken]);

  const ref = reference.status === 'ready' ? reference.data : undefined;

  return (
    <AdminShell area={area} width="max-w-4xl">
      <Link
        href="/admin/providers"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← All providers
      </Link>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {!provider ? (
        <p className="text-muted-foreground text-sm">Loading provider…</p>
      ) : (
        <>
          <header className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{provider.displayName}</h1>
              <Badge variant={PROVIDER_STATUS[provider.status].tone}>
                {PROVIDER_STATUS[provider.status].label}
              </Badge>
              {provider.operations.documents.verified ? (
                <Badge variant="default">Verified provider</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">
              {PROVIDER_TYPE_LABEL[provider.providerType]} · owner{' '}
              <Link
                href={`/admin/users/${provider.owner.id}`}
                className="underline underline-offset-4"
              >
                {provider.owner.fullName}
              </Link>{' '}
              ({provider.owner.email}, account{' '}
              {USER_STATUS[provider.operations.ownerStatus].label.toLowerCase()}) · approved{' '}
              {formatDateTime(provider.approvedAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/admin/documents?providerId=${provider.id}`} />}
              >
                Documents
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/admin/vehicles?providerId=${provider.id}`} />}
              >
                Vehicles
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/admin/bookings?providerId=${provider.id}`} />}
              >
                Bookings
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/admin/providers/applications/${provider.applicationId}`} />}
              >
                Application
              </Button>
            </div>
          </header>

          {provider.suspensionReason ? (
            <FormMessage variant="destructive" title="Suspension reason">
              <p className="whitespace-pre-wrap">{provider.suspensionReason}</p>
              <p className="text-xs">Suspended {formatDateTime(provider.suspendedAt)}.</p>
            </FormMessage>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <AuthCard
              title="Profile"
              description="As shown to the platform team; phone is not verified."
            >
              <DetailRows
                rows={[
                  ['Contact person', provider.contactName],
                  ['Phone / WhatsApp', `${provider.phone} / ${provider.whatsapp ?? '—'}`],
                  ['Address', provider.addressText],
                  [
                    'District / primary place',
                    `${districtName(ref, provider.districtId)} / ${placeName(ref, provider.primaryPlaceId)}`,
                  ],
                  [
                    'Service areas',
                    provider.serviceAreaPlaceIds.map((id) => placeName(ref, id)).join(', ') || '—',
                  ],
                  [
                    'Vehicle types',
                    provider.vehicleCategoryIds.map((id) => categoryName(ref, id)).join(', ') ||
                      '—',
                  ],
                  [
                    'Years / fleet estimate',
                    `${provider.yearsOperating ?? '—'} / ${provider.fleetSizeEstimate ?? '—'}`,
                  ],
                  [
                    'Delivery / airport',
                    `${provider.offersDelivery ? 'delivery' : 'no delivery'} · ${provider.offersAirportTransfer ? 'airport transfers' : 'no airport transfers'}`,
                  ],
                  ['Website', provider.websiteUrl ?? '—'],
                  ['Public slug', provider.slug],
                ]}
              />
              {provider.description ? (
                <p className="mt-3 text-sm whitespace-pre-wrap">{provider.description}</p>
              ) : null}
            </AuthCard>

            <OperationsCard provider={provider} />
          </div>

          <AuthCard
            title="Standing"
            description="Suspension removes every listing from search immediately and blocks new requests. Existing bookings are not cancelled."
          >
            {provider.status === 'active' && provider.operations.bookings.confirmedOrActive > 0 ? (
              <FormMessage variant="destructive" title="Bookings in progress">
                {provider.operations.bookings.confirmedOrActive} confirmed or active booking
                {provider.operations.bookings.confirmedOrActive === 1 ? '' : 's'} would be stranded
                by a suspension. Contact the customers or cancel those bookings first.
              </FormMessage>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3">
              {provider.status === 'active' ? (
                <ReasonAction
                  label="Suspend provider"
                  confirmLabel="Suspend"
                  variant="destructive"
                  placeholder="Reason shown to the provider (min 5 characters)"
                  onConfirm={async (reason) =>
                    setProvider(
                      await withAccessToken((t) =>
                        api.admin.suspendProvider(t, provider.id, reason),
                      ),
                    )
                  }
                />
              ) : (
                <ReasonAction
                  label="Reactivate provider"
                  confirmLabel="Reactivate"
                  optional
                  placeholder="Internal note (optional)"
                  onConfirm={async (note) =>
                    setProvider(
                      await withAccessToken((t) =>
                        api.admin.reactivateProvider(t, provider.id, note || undefined),
                      ),
                    )
                  }
                />
              )}
            </div>
          </AuthCard>
        </>
      )}
    </AdminShell>
  );
}

function OperationsCard({ provider }: { provider: AdminProviderDetail }) {
  const ops = provider.operations;
  const docs = ops.documents;
  const docList = (types: readonly (keyof typeof DOCUMENT_TYPE_LABEL)[]) =>
    types.length === 0 ? 'none' : types.map((t) => DOCUMENT_TYPE_LABEL[t]).join(', ');
  return (
    <AuthCard title="Operations" description="Live counts to read before any decision.">
      <DetailRows
        rows={[
          [
            'Vehicles',
            `${ops.vehicles.total} total · ${ops.vehicles.approved} approved · ${ops.vehicles.searchable} searchable · ${ops.vehicles.awaitingReview} awaiting review · ${ops.vehicles.suspended} suspended`,
          ],
          [
            'Bookings',
            `${ops.bookings.open} open · ${ops.bookings.confirmedOrActive} confirmed/active · ${ops.bookings.completed} completed`,
          ],
          [
            'Open disputes',
            ops.openDisputes > 0 ? (
              <Link href="/admin/disputes?status=open" className="underline underline-offset-4">
                {ops.openDisputes}
              </Link>
            ) : (
              '0'
            ),
          ],
          [
            'Documents',
            docs.verified
              ? 'Verified provider: identity (and business registration where required) approved and in date.'
              : `Not verified · missing: ${docList(docs.missing)} · expired: ${docList(docs.expired)} · pending: ${docList(docs.pending)}`,
          ],
        ]}
      />
      <div className="mt-4">
        <p className="text-muted-foreground mb-1 text-sm">Trust metrics (Phase 8 formulas)</p>
        <ProviderMetricsList metrics={ops.metrics} />
      </div>
    </AuthCard>
  );
}
