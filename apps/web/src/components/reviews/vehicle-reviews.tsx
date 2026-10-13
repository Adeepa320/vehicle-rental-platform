'use client';

import type { PublicReview, RatingSummary } from '@vrp/contracts';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { RatingSummaryLine } from '@/components/reviews/rating-stars';
import { ReviewCard } from '@/components/reviews/review-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';

/** Published reviews of a vehicle with "load more" (keyset cursor from the API). */
export function VehicleReviews({
  slug,
  providerName,
  initialSummary,
}: {
  slug: string;
  providerName: string;
  initialSummary: RatingSummary;
}) {
  const { api } = useAuth();
  const [reviews, setReviews] = useState<PublicReview[] | null>(null);
  const [summary, setSummary] = useState<RatingSummary>(initialSummary);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.public
      .vehicleReviews(slug, { limit: 10 })
      .then((page) => {
        if (cancelled) return;
        setReviews(page.data);
        setSummary(page.summary);
        setCursor(page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, slug]);

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await api.public.vehicleReviews(slug, { limit: 10, cursor });
      setReviews((current) => [...(current ?? []), ...page.data]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3" aria-labelledby="reviews-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reviews-heading" className="text-lg font-semibold">
          Reviews
        </h2>
        <RatingSummaryLine summary={summary} />
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {reviews === null ? (
        <p className="text-muted-foreground text-sm">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No reviews yet. Reviews come from customers after a completed rental booked on this
          platform.
        </p>
      ) : (
        <div className="grid gap-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} providerName={providerName} />
          ))}
          {cursor ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadMore()}>
              {busy ? 'Loading…' : 'Load more reviews'}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
