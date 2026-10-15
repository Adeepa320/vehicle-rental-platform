'use client';

import {
  DISPUTABLE_BOOKING_STATUSES,
  DISPUTE_DESCRIPTION_MAX,
  DisputeReasonCodeSchema,
  OpenDisputeRequestSchema,
  type Booking,
  type BookingDisputeState,
  type Dispute,
  type DisputeReasonCode,
} from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { DisputeThread } from '@/components/disputes/dispute-thread';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DISPUTE_REASON_LABEL, DISPUTE_RESOLUTION_LABEL, DISPUTE_STATUS } from '@/lib/admin-labels';
import { useAuth } from '@/lib/auth/auth-context';
import { BOOKING_STATUS, formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

/**
 * Participant view of a booking's dispute: eligibility, the open form, or the
 * existing dispute with its thread. Used by the customer and provider pages;
 * the API decides who may see and post what.
 */
export function BookingDispute({ bookingId, backHref }: { bookingId: string; backHref: string }) {
  const { api, withAccessToken } = useAuth();
  const [state, setState] = useState<BookingDisputeState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    withAccessToken((t) => api.disputes.bookingState(t, bookingId))
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, bookingId, withAccessToken]);

  const setDispute = (dispute: Dispute) =>
    setState((current) => ({
      eligible: false,
      reason: 'already_exists',
      windowClosesAt: current?.windowClosesAt ?? null,
      dispute,
    }));

  if (error) return <FormMessage variant="destructive">{error}</FormMessage>;
  if (!state) return <p className="text-muted-foreground text-sm">Loading…</p>;

  if (state.dispute) {
    return <DisputeView dispute={state.dispute} backHref={backHref} onChanged={setDispute} />;
  }
  if (state.eligible) {
    return (
      <OpenDisputeForm
        bookingId={bookingId}
        windowClosesAt={state.windowClosesAt}
        onOpened={setDispute}
      />
    );
  }
  return (
    <AuthCard title="Dispute">
      <p className="text-muted-foreground text-sm">
        {state.reason === 'window_closed'
          ? `The time to open a dispute for this booking ended on ${formatDateTime(state.windowClosesAt)}.`
          : state.reason === 'not_participant'
            ? 'Only the customer and the provider of this booking can open a dispute.'
            : 'Disputes can be opened once the rental is in progress, completed, cancelled or recorded as a no-show.'}
      </p>
    </AuthCard>
  );
}

function DisputeView({
  dispute,
  backHref,
  onChanged,
}: {
  dispute: Dispute;
  backHref: string;
  onChanged: (dispute: Dispute) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const status = DISPUTE_STATUS[dispute.status];
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Dispute · {dispute.bookingReference}
          </h1>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {dispute.vehicleTitle} · booking{' '}
          {BOOKING_STATUS[dispute.bookingStatus].label.toLowerCase()} ·{' '}
          <Link href={backHref} className="underline underline-offset-4">
            open the booking
          </Link>
        </p>
        <p className="text-sm">{status.description}</p>
      </header>
      {dispute.resolutionCode ? (
        <FormMessage title={`Outcome: ${DISPUTE_RESOLUTION_LABEL[dispute.resolutionCode]}`}>
          <p className="whitespace-pre-wrap">{dispute.publicResolutionNote}</p>
          <p className="text-xs">
            Recorded by the platform team {formatDateTime(dispute.resolvedAt)}.
            {dispute.resolutionCode === 'refund_recommended'
              ? ' Any refund is handled separately by the platform team; you will be contacted about the method and timing.'
              : ''}
          </p>
        </FormMessage>
      ) : null}
      <AuthCard
        title={DISPUTE_REASON_LABEL[dispute.reasonCode]}
        description={`Opened ${formatDateTime(dispute.createdAt)} by ${dispute.openedByMe ? 'you' : `the ${dispute.openedBy}`}.`}
      >
        <p className="text-sm whitespace-pre-wrap">{dispute.description}</p>
      </AuthCard>
      <AuthCard
        title="Messages"
        description="Both parties and the platform team see every message. Keep it factual; do not share payment details here."
      >
        <DisputeThread
          messages={dispute.messages}
          canMessage={dispute.canMessage}
          closedNote="This dispute is closed; no further messages can be added."
          onSend={async (body) =>
            onChanged(await withAccessToken((t) => api.disputes.message(t, dispute.id, { body })))
          }
        />
      </AuthCard>
    </div>
  );
}

function OpenDisputeForm({
  bookingId,
  windowClosesAt,
  onOpened,
}: {
  bookingId: string;
  windowClosesAt: string | null;
  onOpened: (dispute: Dispute) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [reasonCode, setReasonCode] = useState<DisputeReasonCode>('vehicle_condition');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = OpenDisputeRequestSchema.safeParse({
      reasonCode,
      description: description.trim(),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onOpened(await withAccessToken((t) => api.disputes.open(t, bookingId, parsed.data)));
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Open a dispute"
      description="Tell the platform team what went wrong. The other party sees your description and can reply; the team reviews the thread and records an outcome. Disputes do not move money automatically."
    >
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        <FormField id="dispute-reason" label="What is this about?" error={errors.reasonCode}>
          <select
            id="dispute-reason"
            className={selectClass}
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as DisputeReasonCode)}
          >
            {DisputeReasonCodeSchema.options.map((code) => (
              <option key={code} value={code}>
                {DISPUTE_REASON_LABEL[code]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id="dispute-description"
          label="What happened?"
          error={errors.description}
          hint={`At least 20 characters, up to ${DISPUTE_DESCRIPTION_MAX}. Include dates, what was agreed and what you expect.`}
        >
          <Textarea
            id="dispute-description"
            className="min-h-32"
            maxLength={DISPUTE_DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        {windowClosesAt ? (
          <p className="text-muted-foreground text-xs">
            A dispute can be opened until {formatDateTime(windowClosesAt)}.
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={busy || description.trim().length < 20}>
            {busy ? 'Opening…' : 'Open dispute'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

/** Card on a booking page linking to the dispute page; shows the existing dispute's status. */
export function DisputeCta({ booking, href }: { booking: Booking; href: string }) {
  const { api, withAccessToken } = useAuth();
  const disputable = (DISPUTABLE_BOOKING_STATUSES as readonly string[]).includes(booking.status);
  const [state, setState] = useState<BookingDisputeState | null>(null);

  useEffect(() => {
    if (!disputable) return;
    let cancelled = false;
    withAccessToken((t) => api.disputes.bookingState(t, booking.id))
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {
        // The card still links to the dispute page, which shows the real state.
      });
    return () => {
      cancelled = true;
    };
  }, [api, booking.id, disputable, withAccessToken]);

  if (!disputable) return null;
  const dispute = state?.dispute ?? null;
  return (
    <AuthCard
      title="Problem with this rental?"
      description="Raise it with the platform team. Both parties can add messages; the team records an outcome."
    >
      <div className="grid gap-2 text-sm">
        {dispute ? (
          <p>
            Dispute {DISPUTE_STATUS[dispute.status].label.toLowerCase()} ·{' '}
            {DISPUTE_REASON_LABEL[dispute.reasonCode]} · {dispute.messages.length} message
            {dispute.messages.length === 1 ? '' : 's'}
          </p>
        ) : state && !state.eligible ? (
          <p className="text-muted-foreground">
            {state.reason === 'window_closed'
              ? `The dispute window closed on ${formatDateTime(state.windowClosesAt)}.`
              : 'A dispute cannot be opened for this booking.'}
          </p>
        ) : null}
        <div>
          <Button
            size="sm"
            variant={dispute ? 'outline' : 'default'}
            nativeButton={false}
            render={<Link href={href} />}
          >
            {dispute ? 'View dispute' : 'Open a dispute'}
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
