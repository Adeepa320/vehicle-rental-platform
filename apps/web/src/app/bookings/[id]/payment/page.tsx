'use client';

import { formatLkr, type Booking } from '@vrp/contracts';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { PayAdvanceButton } from '@/components/bookings/payment-parts';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

const POLL_MS = 3000;
const MAX_POLLS = 40;

type Phase = 'checking' | 'waiting' | 'confirmed' | 'failed' | 'cancelled' | 'closed' | 'timeout';

/**
 * Where the gateway sends the browser back (`return_url` / `cancel_url`).
 * The URL carries no payment outcome and is never trusted: this page polls
 * our own API until the server-verified notification has been processed.
 * `?result=cancel` only changes the wording while we wait.
 */
export default function PaymentStatusPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-2xl px-4 py-12">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <PaymentStatus />
    </Suspense>
  );
}

/** Derived from the server's booking view only. */
function phaseOf(booking: Booking): Phase {
  if (
    booking.status === 'confirmed' ||
    booking.status === 'active' ||
    booking.status === 'completed'
  ) {
    return 'confirmed';
  }
  if (booking.status !== 'accepted') return 'closed';
  if (booking.payment.state === 'failed') return 'failed';
  if (booking.payment.state === 'cancelled') return 'cancelled';
  return 'waiting';
}

function PaymentStatus() {
  const gate = useRequireAuth();
  const { api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const cameBackViaCancel = useSearchParams().get('result') === 'cancel';
  const [booking, setBooking] = useState<Booking | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== 'ready' || !params.id) return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      withAccessToken((t) => api.bookings.get(t, params.id))
        .then((b) => {
          if (cancelled) return;
          setBooking(b);
          const next = phaseOf(b);
          polls += 1;
          if (next === 'waiting' && polls < MAX_POLLS) {
            setPhase('waiting');
            timer = setTimeout(poll, POLL_MS);
          } else {
            setPhase(next === 'waiting' ? 'timeout' : next);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(submitErrorFrom(caught).message);
        });
    };
    timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, gate, params.id, withAccessToken]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <FormMessage variant="destructive">{error}</FormMessage>
      </main>
    );
  }

  const canRetry = booking?.allowedActions.includes('pay') ?? false;
  const retryable = phase === 'failed' || phase === 'cancelled' || phase === 'timeout';
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Payment status</h1>
        {booking ? (
          <p className="text-muted-foreground text-sm">
            Booking {booking.reference} · {booking.vehicle.title} · advance{' '}
            {formatLkr(booking.price.advance)}
          </p>
        ) : null}
      </header>

      {phase === 'checking' ? (
        <p className="text-muted-foreground text-sm">Checking your payment…</p>
      ) : null}
      {phase === 'waiting' ? (
        <FormMessage
          title={
            cameBackViaCancel ? 'Payment not completed yet' : 'Waiting for payment confirmation'
          }
        >
          {cameBackViaCancel
            ? 'You left the payment page before it finished. If you did complete the payment, this page updates as soon as the payment provider confirms it; otherwise you can try again from your booking.'
            : 'We are waiting for the payment provider to confirm your payment. This usually takes a few seconds; this page refreshes automatically.'}
        </FormMessage>
      ) : null}
      {phase === 'timeout' ? (
        <FormMessage title="Still waiting">
          The payment provider has not confirmed yet. If you completed the payment, it will be
          applied automatically and you will receive an e-mail; you can also check the booking page
          later. If you did not complete it, you can try again.
        </FormMessage>
      ) : null}
      {phase === 'confirmed' && booking ? (
        <FormMessage title="Payment confirmed">
          Your advance of {formatLkr(booking.price.advance)} was received
          {booking.payment.paidAt ? ` on ${formatDateTime(booking.payment.paidAt)}` : ''} and the
          booking is confirmed. The pickup address and the provider’s contact details are now on
          your booking page. The balance of {formatLkr(booking.price.balanceDue)} and the refundable
          deposit of {formatLkr(booking.price.securityDeposit)} are paid to the provider at pickup.
        </FormMessage>
      ) : null}
      {phase === 'failed' ? (
        <FormMessage variant="destructive" title="Payment failed">
          The payment did not go through and nothing was charged. The vehicle stays reserved for you
          until the payment deadline; you can try again.
        </FormMessage>
      ) : null}
      {phase === 'cancelled' ? (
        <FormMessage variant="destructive" title="Payment cancelled">
          The payment was cancelled before it completed. Nothing was charged; you can try again
          until the payment deadline.
        </FormMessage>
      ) : null}
      {phase === 'closed' && booking ? (
        <FormMessage variant="destructive" title="Booking no longer awaiting payment">
          This booking is {booking.status.replaceAll('_', ' ')}. If you completed a payment after it
          closed, our team will contact you about the refund.
        </FormMessage>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {booking && canRetry && retryable ? (
          <PayAdvanceButton bookingId={booking.id} amount={booking.price.advance} />
        ) : null}
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/bookings/${params.id}`} />}
        >
          Return to booking
        </Button>
      </div>
    </main>
  );
}
