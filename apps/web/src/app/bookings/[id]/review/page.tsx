'use client';

import type { BookingReviewState, CustomerReview } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { Stars } from '@/components/reviews/rating-stars';
import { ReviewForm } from '@/components/reviews/review-form';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function BookingReviewPage() {
  const gate = useRequireAuth();
  const { api, withAccessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<BookingReviewState | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gate !== 'ready' || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.bookings.reviewState(t, params.id))
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, params.id, withAccessToken]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <FormMessage variant="destructive">{error}</FormMessage>
      </main>
    );
  }
  if (gate !== 'ready' || !state) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  const saved = (review: CustomerReview) => {
    setState({ ...state, eligible: false, reason: 'already_reviewed', review });
    setEditing(false);
  };
  const showForm = (state.eligible && !state.review) || (editing && state.review?.canEditUntil);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <Link
        href={`/bookings/${params.id}`}
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← Back to booking {state.reference}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {state.review ? 'Your review of' : 'Review'} {state.vehicle.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          Booking {state.reference}. Reviews are published immediately with your first name and last
          initial; our team can hide reviews that break the rules.
        </p>
      </header>

      {showForm ? (
        <AuthCard
          title={state.review ? 'Edit your review' : 'How was your rental?'}
          description={
            state.windowClosesAt
              ? `You can leave or change your review until ${formatDateTime(state.windowClosesAt)}.`
              : undefined
          }
        >
          <ReviewForm
            existing={state.review}
            onSubmit={(body) =>
              withAccessToken((t) =>
                state.review
                  ? api.bookings.updateReview(t, params.id, body)
                  : api.bookings.createReview(t, params.id, body),
              )
            }
            onSaved={saved}
          />
        </AuthCard>
      ) : state.review ? (
        <AuthCard
          title="Your review"
          description={`Published ${formatDateTime(state.review.createdAt)}.`}
        >
          <div className="grid gap-2 text-sm">
            <p>
              <Stars value={state.review.overallRating} />
              {state.review.status === 'hidden' ? (
                <span className="text-muted-foreground"> (hidden by the platform team)</span>
              ) : null}
            </p>
            {state.review.comment ? (
              <p className="whitespace-pre-wrap">{state.review.comment}</p>
            ) : null}
            {state.review.providerReply ? (
              <div className="bg-muted/50 rounded-md border-l-2 p-2">
                <p className="text-muted-foreground text-xs">Reply from the provider</p>
                <p className="whitespace-pre-wrap">{state.review.providerReply}</p>
              </div>
            ) : null}
            {state.review.canEditUntil ? (
              <div>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit review
                </Button>
                <p className="text-muted-foreground mt-1 text-xs">
                  Editable until {formatDateTime(state.review.canEditUntil)}.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {state.review.editLockReason === 'provider_replied'
                  ? 'This review can no longer be edited because the provider has replied.'
                  : state.review.editLockReason === 'hidden'
                    ? 'Hidden reviews cannot be edited; contact support if you think this was a mistake.'
                    : 'The editing period has ended.'}
              </p>
            )}
          </div>
        </AuthCard>
      ) : (
        <FormMessage title={state.reason === 'window_closed' ? 'Review period closed' : 'Not yet'}>
          {state.reason === 'window_closed'
            ? `Reviews for this booking were possible until ${formatDateTime(state.windowClosesAt)}.`
            : 'You can review this booking once the rental is completed.'}
        </FormMessage>
      )}
    </main>
  );
}
