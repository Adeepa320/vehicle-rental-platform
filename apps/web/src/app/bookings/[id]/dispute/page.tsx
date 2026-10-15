'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { BookingDispute } from '@/components/disputes/booking-dispute';
import { useRequireAuth } from '@/lib/auth/use-require-auth';

export default function CustomerDisputePage() {
  const gate = useRequireAuth();
  const params = useParams<{ id: string }>();
  const backHref = `/bookings/${params.id}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <Link href={backHref} className="text-muted-foreground text-sm underline underline-offset-4">
        ← Back to the booking
      </Link>
      {gate !== 'ready' || !params.id ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <BookingDispute bookingId={params.id} backHref={backHref} />
      )}
    </main>
  );
}
