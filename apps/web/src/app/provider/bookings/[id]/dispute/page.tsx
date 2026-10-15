'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { FormMessage } from '@/components/auth/form-primitives';
import { BookingDispute } from '@/components/disputes/booking-dispute';
import { ProviderNav } from '@/components/provider/provider-nav';
import { useProviderArea } from '@/lib/auth/use-provider-area';

export default function ProviderDisputePage() {
  const area = useProviderArea();
  const params = useParams<{ id: string }>();
  const backHref = `/provider/bookings/${params.id}`;

  if (area.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <FormMessage variant="destructive">{area.message}</FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <Link href={backHref} className="text-muted-foreground text-sm underline underline-offset-4">
        ← Back to the booking
      </Link>
      {area.status !== 'ready' || !params.id ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <BookingDispute bookingId={params.id} backHref={backHref} />
      )}
    </main>
  );
}
