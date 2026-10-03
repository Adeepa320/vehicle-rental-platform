import { formatLkr, type PublicVehicleDetail } from '@vrp/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AvailabilityPanel } from '@/components/public/availability-panel';
import { DetailMap } from '@/components/public/detail-map';
import { Gallery } from '@/components/public/gallery';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError, createApiClient } from '@/lib/api-client';
import { serverEnv } from '@/lib/env';
import { FUEL_LABEL, FUEL_POLICY_LABEL, TRANSMISSION_LABEL } from '@/lib/vehicle-labels';

// Public listing pages are rendered on the server for crawlers and shared links.
export const dynamic = 'force-dynamic';

type Params = { slug: string };

async function loadVehicle(slug: string): Promise<PublicVehicleDetail | null> {
  const env = serverEnv();
  const api = createApiClient({ baseUrl: env.API_INTERNAL_URL, timeoutMs: 5_000 });
  try {
    return await api.public.vehicle(slug);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 400))
      return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const vehicle = await loadVehicle(slug).catch(() => null);
  if (!vehicle) return { title: 'Vehicle not found' };
  const description = `${vehicle.make} ${vehicle.model} ${vehicle.modelYear} for rent in ${vehicle.place.name}, ${vehicle.place.districtName} from ${formatLkr(vehicle.pricing.dailyRate)} per day. Platform-approved provider ${vehicle.provider.displayName}. Deposit ${formatLkr(vehicle.pricing.securityDeposit)}.`;
  return {
    title: `${vehicle.title} – rent in ${vehicle.place.name}`,
    description,
    alternates: { canonical: `/vehicles/${vehicle.slug}` },
    openGraph: {
      title: vehicle.title,
      description,
      images: vehicle.photos[0] ? [{ url: vehicle.photos[0].variants.large }] : [],
    },
  };
}

export default async function VehiclePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const vehicle = await loadVehicle(slug);
  if (!vehicle) notFound();

  const specs: [string, string][] = [
    ['Category', vehicle.categoryId],
    ['Transmission', vehicle.transmission ? TRANSMISSION_LABEL[vehicle.transmission] : '—'],
    ['Fuel', vehicle.fuelType ? FUEL_LABEL[vehicle.fuelType] : '—'],
    ['Seats', vehicle.seats === null ? '—' : String(vehicle.seats)],
    ['Doors', vehicle.doors === null ? '—' : String(vehicle.doors)],
    ['Luggage', vehicle.luggageCapacity === null ? '—' : `${vehicle.luggageCapacity} bags`],
    ['Engine', vehicle.engineCc === null ? '—' : `${vehicle.engineCc} cc`],
    ['Air conditioning', vehicle.hasAc ? 'Yes' : 'No'],
    ['Colour', vehicle.color ?? '—'],
  ];
  const rules: [string, string][] = [
    [
      'Minimum rental',
      `${vehicle.pricing.minRentalDays} day${vehicle.pricing.minRentalDays === 1 ? '' : 's'}`,
    ],
    [
      'Maximum rental',
      vehicle.pricing.maxRentalDays === null ? 'No limit' : `${vehicle.pricing.maxRentalDays} days`,
    ],
    [
      'Minimum renter age',
      vehicle.rules.minRenterAge === null ? 'Not specified' : `${vehicle.rules.minRenterAge} years`,
    ],
    [
      'Licence held for',
      vehicle.rules.minLicenceYears === null
        ? 'Not specified'
        : `${vehicle.rules.minLicenceYears} year${vehicle.rules.minLicenceYears === 1 ? '' : 's'}`,
    ],
    [
      'Fuel policy',
      vehicle.rules.fuelPolicy ? FUEL_POLICY_LABEL[vehicle.rules.fuelPolicy] : 'Not specified',
    ],
    [
      'Weekly price',
      vehicle.pricing.weeklyRate ? formatLkr(vehicle.pricing.weeklyRate) : 'Daily rate applies',
    ],
    [
      'Monthly price',
      vehicle.pricing.monthlyRate ? formatLkr(vehicle.pricing.monthlyRate) : 'Daily rate applies',
    ],
    [
      'Delivery',
      vehicle.deliveryAvailable
        ? `Available${vehicle.deliveryFee ? ` · ${formatLkr(vehicle.deliveryFee)}` : ' · price on request'}`
        : 'Pickup only',
    ],
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <Link href="/search" className="text-muted-foreground text-sm underline underline-offset-4">
        ← Back to search
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{vehicle.title}</h1>
        <p className="text-muted-foreground">
          {vehicle.make} {vehicle.model} {vehicle.modelYear} · {vehicle.place.name},{' '}
          {vehicle.place.districtName}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-8">
          <Gallery photos={vehicle.photos} title={vehicle.title} />

          {vehicle.description ? (
            <p className="whitespace-pre-wrap">{vehicle.description}</p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Specifications</CardTitle>
            </CardHeader>
            <CardContent>
              <Rows rows={specs} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pricing and rental rules</CardTitle>
              <CardDescription>
                Listed by the provider. Estimates exclude the refundable deposit, delivery and extra
                kilometres.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Rows rows={rules} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pickup area</CardTitle>
              <CardDescription>
                {vehicle.place.name}, {vehicle.place.districtName}. Exact address and pickup
                instructions are shared after a booking is confirmed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vehicle.approxPoint ? (
                <DetailMap
                  point={vehicle.approxPoint}
                  title={vehicle.title}
                  placeName={vehicle.place.name}
                />
              ) : (
                <p className="text-muted-foreground text-sm">Map unavailable for this listing.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="grid gap-4 self-start">
          <Suspense fallback={<div className="bg-muted h-64 animate-pulse rounded-lg" />}>
            <AvailabilityPanel slug={vehicle.slug} pricing={vehicle.pricing} />
          </Suspense>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{vehicle.provider.displayName}</CardTitle>
              <CardDescription>
                <Badge variant="secondary">Platform-approved provider</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground grid gap-1 text-sm">
              <p>
                Based in {vehicle.provider.primaryPlace.name} · approved since{' '}
                {vehicle.provider.approvedSince}
              </p>
              {vehicle.provider.yearsOperating !== null ? (
                <p>{vehicle.provider.yearsOperating} years operating</p>
              ) : null}
              <p>
                {vehicle.provider.vehicleCount} listing
                {vehicle.provider.vehicleCount === 1 ? '' : 's'} on the platform
              </p>
              {vehicle.provider.description ? (
                <p className="text-foreground mt-2 whitespace-pre-wrap">
                  {vehicle.provider.description}
                </p>
              ) : null}
              <p className="mt-2 text-xs">
                Our team reviewed this provider’s details and operating area. Contact details are
                shared once a booking is confirmed.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
