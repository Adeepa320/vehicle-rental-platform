'use client';

import {
  AdminCancellationActorSchema,
  TERMINAL_BOOKING_STATUSES,
  formatLkr,
  type AdminBooking,
  type AdminCancellationActor,
  type CancellationPreview,
  type ResendNotificationResponse,
  type ResendTemplate,
} from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { ReasonAction } from '@/components/admin/reason-action';
import { selectClass } from '@/components/admin/admin-shell';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { CANCELLATION_ACTOR_LABEL, RESEND_TEMPLATE_LABEL } from '@/lib/admin-labels';
import { useAuth } from '@/lib/auth/auth-context';
import { BOOKING_STATUS, formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

/**
 * Admin cancellation: pick who the platform cancels on behalf of, read the
 * server's preview (status, hold, refund rule), then confirm with a reason.
 * The preview is advisory; the API re-evaluates everything on the write.
 */
export function AdminCancellationCard({
  booking,
  onChanged,
}: {
  booking: AdminBooking;
  onChanged: (booking: AdminBooking) => void;
}) {
  const { api, withAccessToken } = useAuth();
  const [actor, setActor] = useState<AdminCancellationActor>('platform');
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isFinal = TERMINAL_BOOKING_STATUSES.includes(booking.status);

  useEffect(() => {
    if (isFinal) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.cancellationPreview(t, booking.id, actor))
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, api, booking.id, booking.version, isFinal, withAccessToken]);

  if (isFinal) {
    return (
      <AuthCard title="Admin cancellation">
        <p className="text-muted-foreground text-sm">
          This booking is final ({BOOKING_STATUS[booking.status].label.toLowerCase()}); nothing to
          cancel.
        </p>
      </AuthCard>
    );
  }

  const current = preview && preview.actor === actor ? preview : null;

  return (
    <AuthCard
      title="Admin cancellation"
      description="Cancels on behalf of a party or by the platform. Both parties are notified with your reason; the refund rule follows the actor (customer rules, or full refund for provider / platform). Refunds are still recorded manually under Payments."
    >
      <div className="grid gap-3">
        <select
          className={selectClass}
          value={actor}
          onChange={(e) => setActor(e.target.value as AdminCancellationActor)}
        >
          {AdminCancellationActorSchema.options.map((a) => (
            <option key={a} value={a}>
              {CANCELLATION_ACTOR_LABEL[a]}
            </option>
          ))}
        </select>
        {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
        {!current ? (
          <p className="text-muted-foreground text-sm">Checking what this would do…</p>
        ) : !current.allowed ? (
          <FormMessage variant="destructive" title="Not possible right now">
            {current.reason ?? 'The booking cannot be cancelled in its current state.'}
          </FormMessage>
        ) : (
          <dl className="grid gap-1 text-sm sm:grid-cols-[220px_1fr]">
            <dt className="text-muted-foreground">Resulting status</dt>
            <dd>{current.resultingStatus ? BOOKING_STATUS[current.resultingStatus].label : '—'}</dd>
            <dt className="text-muted-foreground">Vehicle hold</dt>
            <dd>
              {current.holdWillBeReleased ? 'Released (dates free again)' : 'No hold to release'}
            </dd>
            <dt className="text-muted-foreground">Advance</dt>
            <dd>
              {current.advancePaid
                ? `${formatLkr(current.advanceAmount)} paid · ${
                    current.forfeited
                      ? 'forfeited under the cancellation policy'
                      : `refund due ${formatLkr(current.refundDueAmount ?? current.advanceAmount)}`
                  }`
                : 'Not paid; nothing to refund'}
            </dd>
            <dt className="text-muted-foreground">Timing</dt>
            <dd>
              {Math.round(current.hoursBeforePickup)} h before pickup (full refund threshold{' '}
              {current.fullRefundHours} h)
            </dd>
          </dl>
        )}
        <div>
          {current?.allowed ? (
            <ReasonAction
              label="Cancel this booking"
              confirmLabel="Confirm cancellation"
              variant="destructive"
              placeholder="Reason shown to both parties and kept in the audit log (5–1000 characters)"
              onConfirm={async (reason) =>
                onChanged(
                  await withAccessToken((t) =>
                    api.admin.cancelBooking(t, booking.id, {
                      actor,
                      reason,
                      version: booking.version,
                    }),
                  ),
                )
              }
            />
          ) : (
            <Button size="sm" variant="outline" disabled>
              Cancel this booking
            </Button>
          )}
        </div>
      </div>
    </AuthCard>
  );
}

/** Re-sends one of the booking's transactional e-mails; wording and recipient are server-side. */
export function ResendEmailCard({ booking }: { booking: AdminBooking }) {
  const { api, withAccessToken } = useAuth();
  const [busy, setBusy] = useState<ResendTemplate | null>(null);
  const [sent, setSent] = useState<ResendNotificationResponse[]>([]);
  const [error, setError] = useState<string | null>(null);

  return (
    <AuthCard
      title="Re-send e-mail"
      description="Only templates that make sense for the booking's current state are offered. Each send is audited."
    >
      {booking.resendableTemplates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No e-mail applies to this booking right now.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {booking.resendableTemplates.map((template) => (
            <Button
              key={template}
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(template);
                setError(null);
                try {
                  const result = await withAccessToken((t) =>
                    api.admin.resendNotification(t, booking.id, template),
                  );
                  setSent((current) => [result, ...current]);
                } catch (caught) {
                  setError(submitErrorFrom(caught).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === template ? 'Sending…' : RESEND_TEMPLATE_LABEL[template]}
            </Button>
          ))}
        </div>
      )}
      {error ? (
        <div className="mt-3">
          <FormMessage variant="destructive">{error}</FormMessage>
        </div>
      ) : null}
      {sent.length > 0 ? (
        <ul className="text-muted-foreground mt-3 grid gap-1 text-xs">
          {sent.map((s) => (
            <li key={`${s.template}-${s.sentAt}`}>
              {RESEND_TEMPLATE_LABEL[s.template]} queued for the {s.recipientRole} ({s.recipient})
              at {formatDateTime(s.sentAt)}.
            </li>
          ))}
        </ul>
      ) : null}
    </AuthCard>
  );
}
