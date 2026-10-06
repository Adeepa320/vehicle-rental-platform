'use client';

import { formatLkr, type BookingPaymentSummary, type CheckoutSession } from '@vrp/contracts';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { PAYMENT_STATE, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

/** One line about the advance, worded for the audience. */
export function PaymentStateLine({
  payment,
  audience,
}: {
  payment: BookingPaymentSummary;
  audience: 'customer' | 'provider';
}) {
  const meta = PAYMENT_STATE[payment.state];
  return (
    <p className="text-sm">
      <Badge variant={meta.tone}>{meta.label}</Badge>{' '}
      <span>
        {meta[audience]}
        {payment.state === 'paid' && payment.paidAt
          ? ` Received ${formatDateTime(payment.paidAt)}.`
          : ''}
        {payment.state === 'refund_due' && payment.refundDueAmount
          ? ` Amount: ${formatLkr(payment.refundDueAmount)}.`
          : ''}
        {payment.state === 'refunded' && payment.refundedAt
          ? ` Recorded ${formatDateTime(payment.refundedAt)}.`
          : ''}
      </span>
    </p>
  );
}

/**
 * Hands the browser to the gateway: PayHere's hosted page expects a classic
 * form POST with the server-signed fields. Submitted automatically on mount;
 * the button stays as a fallback for browsers that block the auto-submit.
 */
export function GatewayRedirectForm({ session }: { session: CheckoutSession }) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => formRef.current?.submit(), 50);
    return () => clearTimeout(timer);
  }, []);
  return (
    <form ref={formRef} method={session.method} action={session.checkoutUrl} className="grid gap-2">
      {Object.entries(session.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="text-muted-foreground text-sm">
        Taking you to the secure payment page for {formatLkr(session.amount)}…
      </p>
      <Button type="submit" variant="outline" size="sm">
        Continue to payment
      </Button>
    </form>
  );
}

/** "Pay advance securely": asks the API for the checkout session, then redirects. */
export function PayAdvanceButton({ bookingId, amount }: { bookingId: string; amount: string }) {
  const { api, withAccessToken } = useAuth();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <GatewayRedirectForm session={session} />;
  return (
    <div className="grid gap-2">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setSession(await withAccessToken((t) => api.bookings.createCheckout(t, bookingId)));
          } catch (caught) {
            setError(submitErrorFrom(caught).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Preparing payment…' : `Pay advance securely (${formatLkr(amount)})`}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
