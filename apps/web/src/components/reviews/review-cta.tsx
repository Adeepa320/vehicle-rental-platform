'use client';

import type { Booking, BookingReviewState } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AuthCard } from '@/components/auth/form-primitives';
import { Stars } from '@/components/reviews/rating-stars';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

/** Review call-to-action on a completed booking: leave, edit, or "period closed". */
export function ReviewCta({ booking }: { booking: Booking }) {
  const { api, withAccessToken } = useAuth();
  const [state, setState] = useState<BookingReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (booking.status !== 'completed') return;
    let cancelled = false;
    withAccessToken((t) => api.bookings.reviewState(t, booking.id))
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, booking.id, booking.status, withAccessToken]);

  if (booking.status !== 'completed') return null;
  const href = `/bookings/${booking.id}/review`;
  return (
    <AuthCard
      title="Your review"
      description="One review per completed rental; shown publicly with your first name and last initial."
    >
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {!state ? (
        <p className="text-muted-foreground text-sm">Checking…</p>
      ) : state.review ? (
        <div className="grid gap-2 text-sm">
          <p>
            <Stars value={state.review.overallRating} />{' '}
            {state.review.status === 'hidden' ? (
              <span className="text-muted-foreground">(hidden by the platform team)</span>
            ) : null}
          </p>
          {state.review.comment ? (
            <p className="whitespace-pre-wrap">{state.review.comment}</p>
          ) : null}
          {state.review.providerReply ? (
            <p className="text-muted-foreground">
              Provider reply: <span className="text-foreground">{state.review.providerReply}</span>
            </p>
          ) : null}
          {state.review.canEditUntil ? (
            <div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={href} />}
              >
                Edit review
              </Button>
              <p className="text-muted-foreground mt-1 text-xs">
                Editable until {formatDateTime(state.review.canEditUntil)}.
              </p>
            </div>
          ) : state.review.editLockReason === 'provider_replied' ? (
            <p className="text-muted-foreground text-xs">
              This review can no longer be edited because the provider has replied.
            </p>
          ) : null}
        </div>
      ) : state.eligible ? (
        <div className="grid gap-2 text-sm">
          <p>How was the rental? Your review helps other travellers and the provider.</p>
          <div>
            <Button size="sm" nativeButton={false} render={<Link href={href} />}>
              Leave a review
            </Button>
          </div>
          {state.windowClosesAt ? (
            <p className="text-muted-foreground text-xs">
              Reviews can be left until {formatDateTime(state.windowClosesAt)}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {state.reason === 'window_closed'
            ? `The review period for this booking closed on ${formatDateTime(state.windowClosesAt)}.`
            : 'Reviews open once the rental is completed.'}
        </p>
      )}
    </AuthCard>
  );
}
