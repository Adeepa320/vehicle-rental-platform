'use client';

import { formatLkr, type AdminPaymentListItem } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { PAYMENT_ANOMALY_LABEL, PAYMENT_STATUS_LABEL, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

/** Troubleshooting queue: payments flagged for manual resolution (late / duplicate / mismatched successes, refunds due). */
export default function AdminPaymentsPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const [rows, setRows] = useState<AdminPaymentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  useEffect(() => {
    if (gate !== 'ready' || !isAdmin) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.listPayments(t, { limit: 50 }))
      .then((page) => {
        if (!cancelled) setRows(page.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, isAdmin, withAccessToken]);

  if (gate === 'ready' && !isAdmin) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <AdminNav />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Payments needing attention</h1>
        <p className="text-muted-foreground text-sm">
          Advances the gateway reported after the booking had closed, paid twice, with a mismatched
          amount, or owed back after a cancellation. Open the booking to record the refund or mark
          the payment resolved. Refunds are processed in the PayHere merchant portal or by bank
          transfer and recorded here; nothing is refunded automatically.
        </p>
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {gate !== 'ready' || rows === null ? (
        <p className="text-muted-foreground text-sm">Loading payments…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing needs attention.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((payment) => (
            <li key={payment.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/bookings/${payment.bookingId}`}
                  className="font-medium underline underline-offset-4"
                >
                  {payment.bookingReference}
                </Link>
                <Badge variant="outline">{PAYMENT_STATUS_LABEL[payment.status]}</Badge>
                <span>{formatLkr(payment.amount)}</span>
                {payment.anomaly ? (
                  <span className="text-destructive">{PAYMENT_ANOMALY_LABEL[payment.anomaly]}</span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Order {payment.orderId} · gateway id {payment.gatewayPaymentId ?? '—'} · created{' '}
                {formatDateTime(payment.createdAt)}
                {payment.refundDueAmount
                  ? ` · refund due ${formatLkr(payment.refundDueAmount)}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
