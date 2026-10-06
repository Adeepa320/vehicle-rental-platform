'use client';

import {
  RecordRefundRequestSchema,
  formatLkr,
  type AdminPayment,
  type PaymentReconciliation,
} from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { ReasonAction } from '@/components/admin/reason-action';
import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { PAYMENT_ANOMALY_LABEL, PAYMENT_STATUS_LABEL, formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

interface AdminPaymentCardProps {
  payment: AdminPayment;
  onChanged: (payment: AdminPayment) => void;
}

/** One payment attempt with its audit trail and the admin actions (refund record, resolve, reconcile). */
export function AdminPaymentCard({ payment, onChanged }: AdminPaymentCardProps) {
  const { api, withAccessToken } = useAuth();
  const [refundOpen, setRefundOpen] = useState(false);
  const [reconciliation, setReconciliation] = useState<PaymentReconciliation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tone =
    payment.status === 'paid'
      ? 'default'
      : payment.status === 'failed'
        ? 'destructive'
        : payment.status === 'refunded'
          ? 'secondary'
          : 'outline';

  return (
    <div className="grid gap-3 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tone}>{PAYMENT_STATUS_LABEL[payment.status]}</Badge>
        <span className="font-medium">{formatLkr(payment.amount)}</span>
        <span className="text-muted-foreground">via {payment.gateway}</span>
        {payment.requiresManualResolution ? (
          <Badge variant="destructive">Needs manual resolution</Badge>
        ) : null}
        {payment.anomaly ? (
          <span className="text-destructive text-xs">{PAYMENT_ANOMALY_LABEL[payment.anomaly]}</span>
        ) : null}
      </div>
      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-[150px_1fr]">
        <dt>Order id</dt>
        <dd className="text-foreground">{payment.orderId}</dd>
        <dt>Gateway payment id</dt>
        <dd className="text-foreground">{payment.gatewayPaymentId ?? '—'}</dd>
        <dt>Gateway status / method</dt>
        <dd className="text-foreground">
          {payment.gatewayStatusCode ?? '—'} / {payment.gatewayMethod ?? '—'}
        </dd>
        <dt>Created</dt>
        <dd className="text-foreground">{formatDateTime(payment.createdAt)}</dd>
        <dt>Paid / failed / cancelled</dt>
        <dd className="text-foreground">
          {formatDateTime(payment.paidAt)} / {formatDateTime(payment.failedAt)} /{' '}
          {formatDateTime(payment.cancelledAt)}
        </dd>
        {payment.failureReason ? (
          <>
            <dt>Failure reason</dt>
            <dd className="text-foreground">{payment.failureReason}</dd>
          </>
        ) : null}
        <dt>Refund</dt>
        <dd className="text-foreground">
          {payment.refundDueAmount ? `due ${formatLkr(payment.refundDueAmount)}` : 'none due'}
          {payment.refundedAmount
            ? ` · refunded ${formatLkr(payment.refundedAmount)} (${payment.refundReference ?? '—'}, ${formatDateTime(payment.refundedAt)})`
            : ''}
        </dd>
      </dl>

      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      {reconciliation ? (
        <FormMessage title="Gateway reconciliation">
          Gateway reports {reconciliation.gatewayStatus ?? 'no record'}
          {reconciliation.gatewayAmount
            ? ` for ${reconciliation.gatewayCurrency} ${reconciliation.gatewayAmount}`
            : ''}{' '}
          (payment id {reconciliation.gatewayPaymentId ?? '—'}) ·{' '}
          {reconciliation.matches ? 'matches our record' : 'does NOT match our record'} ·{' '}
          {formatDateTime(reconciliation.checkedAt)}
        </FormMessage>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {payment.status === 'paid' ? (
          <Button size="sm" variant="outline" onClick={() => setRefundOpen((v) => !v)}>
            Record refund
          </Button>
        ) : null}
        {payment.requiresManualResolution ? (
          <ReasonAction
            label="Mark resolved"
            confirmLabel="Resolve"
            variant="outline"
            placeholder="What was done (required)"
            onConfirm={async (note) => {
              onChanged(
                await withAccessToken((t) => api.admin.resolvePayment(t, payment.id, { note })),
              );
            }}
          />
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            setMessage(null);
            try {
              setReconciliation(
                await withAccessToken((t) => api.admin.reconcilePayment(t, payment.id)),
              );
            } catch (caught) {
              setMessage(submitErrorFrom(caught).message);
            }
          }}
        >
          Check with gateway
        </Button>
      </div>

      {refundOpen ? (
        <RefundForm
          payment={payment}
          onDone={(updated) => {
            setRefundOpen(false);
            onChanged(updated);
          }}
          onCancel={() => setRefundOpen(false)}
        />
      ) : null}

      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">
          Audit trail ({payment.events.length} events)
        </summary>
        <ol className="mt-2 grid gap-1">
          {payment.events.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {event.action}
                <span className="text-muted-foreground">
                  {' '}
                  · {event.actorType}
                  {event.statusCode ? ` · status ${event.statusCode}` : ''}
                  {event.signatureValid === false ? ' · BAD SIGNATURE' : ''}
                  {event.metadata && 'reason' in event.metadata
                    ? ` · ${String(event.metadata.reason)}`
                    : ''}
                </span>
              </span>
              <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function RefundForm({
  payment,
  onDone,
  onCancel,
}: {
  payment: AdminPayment;
  onDone: (payment: AdminPayment) => void;
  onCancel: () => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [mode, setMode] = useState<'manual' | 'gateway'>('manual');
  const [amount, setAmount] = useState(payment.refundDueAmount ?? payment.amount);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = RecordRefundRequestSchema.safeParse({
      mode,
      amount: amount.trim(),
      reason: reason.trim(),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onDone(await withAccessToken((t) => api.admin.recordRefund(t, payment.id, parsed.data)));
    } catch (caught) {
      setMessage(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-md border p-3" onSubmit={(e) => void submit(e)} noValidate>
      <p className="font-medium">Record a refund of this advance</p>
      <p className="text-muted-foreground text-xs">
        “Manual” means you already refunded through the PayHere merchant portal (cards) or by bank
        transfer (wallet / bank methods) and are recording the reference. “Gateway” calls the
        PayHere Refund API and needs merchant-API credentials.
      </p>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id={`mode-${payment.id}`} label="Mode">
          <select
            id={`mode-${payment.id}`}
            className={selectClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'manual' | 'gateway')}
          >
            <option value="manual">Manual (already refunded)</option>
            <option value="gateway">Gateway Refund API</option>
          </select>
        </FormField>
        <FormField id={`amount-${payment.id}`} label="Amount (LKR)" error={errors.amount}>
          <Input
            id={`amount-${payment.id}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField
          id={`reference-${payment.id}`}
          label={mode === 'manual' ? 'Portal / bank reference' : 'Reference (optional)'}
          error={errors.reference}
        >
          <Input
            id={`reference-${payment.id}`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </FormField>
      </div>
      <FormField
        id={`reason-${payment.id}`}
        label="Reason (shown to the customer)"
        error={errors.reason}
      >
        <Textarea
          id={`reason-${payment.id}`}
          className="min-h-14"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Recording…' : 'Record refund'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
