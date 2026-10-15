'use client';

import {
  DisputeResolutionCodeSchema,
  OPEN_DISPUTE_STATUSES,
  formatLkr,
  type AdminDispute,
  type DisputeResolutionCode,
} from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminShell, DetailRows, selectClass } from '@/components/admin/admin-shell';
import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { DisputeThread } from '@/components/disputes/dispute-thread';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DISPUTE_REASON_LABEL, DISPUTE_RESOLUTION_LABEL, DISPUTE_STATUS } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { BOOKING_STATUS, PAYMENT_STATE, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';
import { formatDay } from '@/lib/vehicle-labels';

export default function AdminDisputeDetailPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const params = useParams<{ id: string }>();
  const [dispute, setDispute] = useState<AdminDispute | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.getDispute(t, params.id))
      .then((result) => {
        if (!cancelled) setDispute(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, params.id, ready, withAccessToken]);

  return (
    <AdminShell area={area} width="max-w-4xl">
      <Link
        href="/admin/disputes"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← All disputes
      </Link>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {!dispute ? (
        <p className="text-muted-foreground text-sm">Loading dispute…</p>
      ) : (
        <DisputeDetail dispute={dispute} onChanged={setDispute} />
      )}
    </AdminShell>
  );
}

function DisputeDetail({
  dispute,
  onChanged,
}: {
  dispute: AdminDispute;
  onChanged: (dispute: AdminDispute) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const status = DISPUTE_STATUS[dispute.status];
  const isOpen = OPEN_DISPUTE_STATUSES.includes(dispute.status);
  const payment = PAYMENT_STATE[dispute.payment.state];

  return (
    <>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Dispute on{' '}
            <Link
              href={`/admin/bookings/${dispute.bookingId}`}
              className="underline underline-offset-4"
            >
              {dispute.bookingReference}
            </Link>
          </h1>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {DISPUTE_REASON_LABEL[dispute.reasonCode]} · opened by the {dispute.openedBy}{' '}
          {formatDateTime(dispute.createdAt)} · {dispute.vehicleTitle}
        </p>
      </header>

      {dispute.resolutionCode ? (
        <FormMessage title={`Decision: ${DISPUTE_RESOLUTION_LABEL[dispute.resolutionCode]}`}>
          <p className="whitespace-pre-wrap">{dispute.publicResolutionNote}</p>
          <p className="text-xs">Recorded {formatDateTime(dispute.resolvedAt)}.</p>
        </FormMessage>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <AuthCard title="Booking">
          <DetailRows
            rows={[
              ['Status', BOOKING_STATUS[dispute.bookingStatus].label],
              [
                'Rental',
                `${formatDay(dispute.bookingStartsAt)} → ${formatDay(dispute.bookingEndsAt)}`,
              ],
              [
                'Customer',
                <Link
                  key="c"
                  href={`/admin/users/${dispute.customer.id}`}
                  className="underline underline-offset-4"
                >
                  {dispute.customer.name} · {dispute.customer.email}
                </Link>,
              ],
              [
                'Provider',
                <Link
                  key="p"
                  href={`/admin/providers/${dispute.provider.id}`}
                  className="underline underline-offset-4"
                >
                  {dispute.provider.displayName} · {dispute.provider.ownerEmail}
                </Link>,
              ],
            ]}
          />
        </AuthCard>
        <AuthCard
          title="Advance payment"
          description="Read-only summary. Refunds are recorded under Payments; nothing here moves money."
        >
          <DetailRows
            rows={[
              ['State', payment.label],
              ['Advance', formatLkr(dispute.payment.advanceAmount)],
              ['Paid', formatDateTime(dispute.payment.paidAt)],
              [
                'Refund',
                dispute.payment.refundDueAmount
                  ? `due ${formatLkr(dispute.payment.refundDueAmount)}`
                  : dispute.payment.refundedAt
                    ? `refunded ${formatDateTime(dispute.payment.refundedAt)}`
                    : 'none due',
              ],
            ]}
          />
          <p className="mt-3 text-sm">
            <Link
              href={`/admin/bookings/${dispute.bookingId}`}
              className="underline underline-offset-4"
            >
              Open the booking’s payments
            </Link>
          </p>
        </AuthCard>
      </div>

      <AuthCard title="What the participant reported">
        <p className="text-sm whitespace-pre-wrap">{dispute.description}</p>
      </AuthCard>

      <AuthCard
        title="Thread"
        description="Messages are visible to both participants and the platform team."
      >
        <DisputeThread
          messages={dispute.messages}
          canMessage={isOpen}
          formHint="Posted as “Platform team”; both participants see it and are notified."
          closedNote="The dispute is closed; no further messages."
          onSend={async (body) =>
            onChanged(
              await withAccessToken((t) => api.admin.postDisputeMessage(t, dispute.id, { body })),
            )
          }
        />
      </AuthCard>

      <InternalNoteCard dispute={dispute} onChanged={onChanged} />

      <AuthCard
        title="Decision"
        description="Start the review to take ownership, then resolve with a public note or reject it. Decisions are audited and e-mailed to both parties."
      >
        {!isOpen ? (
          <p className="text-muted-foreground text-sm">This dispute is closed.</p>
        ) : (
          <div className="grid gap-4">
            {dispute.status === 'open' ? (
              <div>
                <ReasonAction
                  label="Start review"
                  confirmLabel="Start review"
                  variant="outline"
                  optional
                  placeholder="Internal note (optional)"
                  onConfirm={async (note) =>
                    onChanged(
                      await withAccessToken((t) =>
                        api.admin.startDisputeReview(t, dispute.id, note ? { note } : {}),
                      ),
                    )
                  }
                />
              </div>
            ) : null}
            <DecisionForm dispute={dispute} onChanged={onChanged} />
          </div>
        )}
      </AuthCard>
    </>
  );
}

function InternalNoteCard({
  dispute,
  onChanged,
}: {
  dispute: AdminDispute;
  onChanged: (dispute: AdminDispute) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [note, setNote] = useState(dispute.internalAdminNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <AuthCard
      title="Internal note"
      description="Not visible to participants. Replaces the previous note."
    >
      <form
        className="grid gap-3"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (note.trim().length === 0) return;
          setBusy(true);
          setError(null);
          setSaved(false);
          try {
            onChanged(
              await withAccessToken((t) =>
                api.admin.setDisputeInternalNote(t, dispute.id, { note: note.trim() }),
              ),
            );
            setSaved(true);
          } catch (caught) {
            setError(submitErrorFrom(caught).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
        <Textarea
          className="min-h-20"
          aria-label="Internal note (not visible to participants)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || note.trim().length === 0}
          >
            {busy ? 'Saving…' : 'Save internal note'}
          </Button>
          {saved ? <span className="text-muted-foreground text-xs">Saved.</span> : null}
        </div>
      </form>
    </AuthCard>
  );
}

function DecisionForm({
  dispute,
  onChanged,
}: {
  dispute: AdminDispute;
  onChanged: (dispute: AdminDispute) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [mode, setMode] = useState<'resolve' | 'reject'>('resolve');
  const [code, setCode] = useState<DisputeResolutionCode>('no_action');
  const [publicNote, setPublicNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = publicNote.trim().length >= 5;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    const internal = internalNote.trim() ? { internalNote: internalNote.trim() } : {};
    try {
      onChanged(
        await withAccessToken((t) =>
          mode === 'resolve'
            ? api.admin.resolveDispute(t, dispute.id, {
                resolutionCode: code,
                publicNote: publicNote.trim(),
                ...internal,
              })
            : api.admin.rejectDispute(t, dispute.id, {
                publicNote: publicNote.trim(),
                ...internal,
              }),
        ),
      );
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-md border p-3" onSubmit={(e) => void submit(e)} noValidate>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'resolve' ? 'default' : 'outline'}
          onClick={() => setMode('resolve')}
        >
          Resolve
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'reject' ? 'default' : 'outline'}
          onClick={() => setMode('reject')}
        >
          Reject (not upheld)
        </Button>
      </div>
      {mode === 'resolve' ? (
        <FormField id="resolution-code" label="Outcome">
          <select
            id="resolution-code"
            className={`${selectClass} w-full`}
            value={code}
            onChange={(e) => setCode(e.target.value as DisputeResolutionCode)}
          >
            {DisputeResolutionCodeSchema.options.map((c) => (
              <option key={c} value={c}>
                {DISPUTE_RESOLUTION_LABEL[c]}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
      {mode === 'resolve' && code === 'refund_recommended' ? (
        <FormMessage title="No payment is changed automatically">
          Recording this outcome only tells both parties that a refund is recommended. Record or
          execute the refund itself under{' '}
          <Link href="/admin/payments" className="underline underline-offset-4">
            Payments
          </Link>{' '}
          (or on the booking’s payment card).
        </FormMessage>
      ) : null}
      <FormField id="public-note" label="Public note (shown to both parties, 5–2000 characters)">
        <Textarea
          id="public-note"
          className="min-h-20"
          value={publicNote}
          onChange={(e) => setPublicNote(e.target.value)}
        />
      </FormField>
      <FormField
        id="decision-internal-note"
        label="Internal note (optional, not visible to participants)"
      >
        <Textarea
          id="decision-internal-note"
          className="min-h-12"
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
        />
      </FormField>
      <div>
        <Button
          type="submit"
          size="sm"
          variant={mode === 'reject' ? 'destructive' : 'default'}
          disabled={busy || !valid}
        >
          {busy ? 'Saving…' : mode === 'resolve' ? 'Record decision' : 'Reject dispute'}
        </Button>
      </div>
    </form>
  );
}
