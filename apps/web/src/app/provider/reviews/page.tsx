'use client';

import { REVIEW_REPLY_MAX, type ProviderReview } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ReasonAction } from '@/components/admin/reason-action';
import { FormMessage } from '@/components/auth/form-primitives';
import { ProviderNav } from '@/components/provider/provider-nav';
import { Stars } from '@/components/reviews/rating-stars';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useProviderArea } from '@/lib/auth/use-provider-area';
import { formatDay } from '@/lib/vehicle-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function ProviderReviewsPage() {
  const area = useProviderArea();
  const { api, withAccessToken } = useAuth();
  const [reviews, setReviews] = useState<ProviderReview[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (area.status !== 'ready') return;
    let cancelled = false;
    withAccessToken((t) => api.providerReviews.list(t, { limit: 20 }))
      .then((page) => {
        if (cancelled) return;
        setReviews(page.data);
        setCursor(page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, area.status, withAccessToken]);

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await withAccessToken((t) => api.providerReviews.list(t, { limit: 20, cursor }));
      setReviews((current) => [...(current ?? []), ...page.data]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  if (area.status === 'error') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <FormMessage variant="destructive">{area.message}</FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ProviderNav />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground text-sm">
          Customers review a rental once it is completed. You can reply once per review; the reply
          is shown publicly under the review. Reviews hidden by our team are marked and not public.
        </p>
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {area.status !== 'ready' || reviews === null ? (
        <p className="text-muted-foreground text-sm">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="text-muted-foreground text-sm">No reviews yet.</p>
      ) : (
        <ul className="grid gap-3">
          {reviews.map((review) => (
            <li key={review.id} className="grid gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={review.overallRating} />
                  <span className="font-medium">{review.reviewer.displayName}</span>
                  <Link
                    href={`/provider/bookings/${review.booking.id}`}
                    className="text-muted-foreground underline underline-offset-4"
                  >
                    {review.booking.reference}
                  </Link>
                  <span className="text-muted-foreground">· {review.vehicle.title}</span>
                  {review.status === 'hidden' ? (
                    <Badge variant="destructive">Hidden by the platform</Badge>
                  ) : null}
                </div>
                <span className="text-muted-foreground text-xs">{formatDay(review.createdAt)}</span>
              </div>
              {review.comment ? <p className="whitespace-pre-wrap">{review.comment}</p> : null}
              {review.providerReply ? (
                <div className="bg-muted/50 rounded-md border-l-2 p-2">
                  <p className="text-muted-foreground text-xs">Your reply</p>
                  <p className="whitespace-pre-wrap">{review.providerReply}</p>
                </div>
              ) : review.status === 'published' ? (
                <div>
                  <ReasonAction
                    label="Reply"
                    confirmLabel="Publish reply"
                    variant="outline"
                    placeholder={`Thank the customer or add context (public, up to ${REVIEW_REPLY_MAX} characters, one reply only)`}
                    onConfirm={async (reply) => {
                      const updated = await withAccessToken((t) =>
                        api.providerReviews.reply(t, review.id, { reply }),
                      );
                      setReviews(
                        (current) =>
                          current?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
                      );
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadMore()}>
          {busy ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </main>
  );
}
