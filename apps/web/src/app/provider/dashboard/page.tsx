'use client';

import type { ProviderProfile } from '@vrp/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { submitErrorFrom } from '@/lib/forms';
import { PROVIDER_STATUS, PROVIDER_TYPE_LABEL, formatDate } from '@/lib/provider-labels';
import { categoryName, districtName, placeName, useReferenceData } from '@/lib/reference';

export default function ProviderDashboardPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const router = useRouter();
  const reference = useReferenceData();
  const [profile, setProfile] = useState<ProviderProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== 'ready' || !user) return;
    if (!user.roles.includes('provider')) {
      router.replace('/provider/application');
      return;
    }
    let cancelled = false;
    withAccessToken((token) => api.providers.myProfile(token))
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, router, user, withAccessToken]);

  if (gate !== 'ready' || profile === undefined) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">
          {error ?? 'Loading your provider dashboard…'}
        </p>
      </main>
    );
  }
  if (profile === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive">
          No provider profile was found for your account.{' '}
          <Link className="underline" href="/provider/application">
            Check your application
          </Link>
          .
        </FormMessage>
      </main>
    );
  }

  const status = PROVIDER_STATUS[profile.status];
  const ref = reference.status === 'ready' ? reference.data : undefined;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{profile.displayName}</h1>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-muted-foreground">
          {PROVIDER_TYPE_LABEL[profile.providerType]} · {placeName(ref, profile.primaryPlaceId)},{' '}
          {districtName(ref, profile.districtId)} · approved {formatDate(profile.approvedAt)}
        </p>
        {profile.status === 'suspended' ? (
          <FormMessage variant="destructive" title="Your provider account is suspended">
            <p className="whitespace-pre-wrap">
              {profile.suspensionReason ?? 'Contact support for details.'}
            </p>
            <p className="mt-2 text-xs">
              Provider actions are disabled until the suspension is lifted.
            </p>
          </FormMessage>
        ) : null}
      </header>

      <FormMessage title="Vehicle listings are coming next">
        Your profile is ready. Adding vehicles, pricing and availability opens in the next release;
        we will e-mail you when it does. Until then, keep your contact details current from the
        account page.
      </FormMessage>

      <AuthCard title="Provider details">
        <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
          {(
            [
              ['Contact person', profile.contactName],
              ['Phone', `${profile.phone}${profile.phoneVerified ? '' : ' (not verified)'}`],
              ['WhatsApp', profile.whatsapp ?? '—'],
              ['Address', profile.addressText],
              [
                'Service areas',
                profile.serviceAreaPlaceIds.map((id) => placeName(ref, id)).join(', ') || '—',
              ],
              [
                'Vehicle types',
                profile.vehicleCategoryIds.map((id) => categoryName(ref, id)).join(', ') || '—',
              ],
              ['Delivery', profile.offersDelivery ? 'Offered' : 'Not offered'],
              ['Airport transfers', profile.offersAirportTransfer ? 'Offered' : 'Not offered'],
              [
                'Years operating',
                profile.yearsOperating === null ? '—' : String(profile.yearsOperating),
              ],
              [
                'Fleet size (estimate)',
                profile.fleetSizeEstimate === null ? '—' : String(profile.fleetSizeEstimate),
              ],
              ['Website', profile.websiteUrl ?? '—'],
              ['Public URL', `/providers/${profile.slug} (available with vehicle listings)`],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {profile.description ? (
          <p className="mt-4 text-sm whitespace-pre-wrap">{profile.description}</p>
        ) : null}
        <div className="mt-4">
          <Button variant="outline" nativeButton={false} render={<Link href="/account" />}>
            Account settings
          </Button>
        </div>
      </AuthCard>
    </main>
  );
}
