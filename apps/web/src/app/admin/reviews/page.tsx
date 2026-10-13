'use client';

import type { AdminReview } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { ReasonAction } from '@/components/admin/reason-action';
import { FormMessage } from '@/components/auth/form-primitives';
import { Stars } from '@/components/reviews/rating-stars';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

const selectClass =
  'border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

export default function AdminReviewsPage() {
  const gate = useRequireAuth();
  const { user, api, withAccessToken } = useAuth();
  const [status, setStatus] = useState<'' | 'published' | 'hidden'>('');
  const [rows, setRows] = useState<AdminReview[] | null>(null);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  useEffect(() => {
    if (gate !== 'ready' || !isAdmin) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.listReviews(t, { status: status || undefined, limit: 30 }))
      .then((page) => {
        if (cancelled) return;
        setRows(page.data);
        setLoadedStatus(status);
        setCursor(page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, isAdmin, status, withAccessToken]);

  if (gate === 'ready' && !isAdmin) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </main>
    );
  }

  const replace = (updated: AdminReview) =>
    setRows((current) => current?.map((r) => (r.id === updated.id ? updated : r)) ?? null);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <AdminNav />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground text-sm">
          Reviews publish immediately; moderation is reactive. Hiding needs a reason, is audited and
          tells the customer; a hidden review stops counting publicly but is kept.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | 'published' | 'hidden')}
        >
          <option value="">All reviews</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {gate !== 'ready' || rows === null || loadedStatus !== status ? (
        <p className="text-muted-foreground text-sm">Loading reviews…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No reviews match.</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((review) => (
            <li key={review.id} className="grid gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={review.overallRating} />
                <Badge variant={review.status === 'hidden' ? 'destructive' : 'outline'}>
                  {review.status}
                </Badge>
                <Link
                  href={`/admin/bookings/${review.booking.id}`}
                  className="underline underline-offset-4"
                >
                  {review.booking.reference}
                </Link>
                <span className="text-muted-foreground">
                  {review.vehicle.title} · {review.provider.displayName}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                {review.customer.name} ({review.customer.email}) ·{' '}
                {formatDateTime(review.createdAt)}
                {review.hiddenAt
                  ? ` · hidden ${formatDateTime(review.hiddenAt)}: ${review.hiddenReason ?? ''}`
                  : ''}
              </p>
              {review.comment ? <p className="whitespace-pre-wrap">{review.comment}</p> : null}
              {review.providerReply ? (
                <p className="text-muted-foreground whitespace-pre-wrap">
                  Provider reply: {review.providerReply}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {review.status === 'published' ? (
                  <ReasonAction
                    label="Hide"
                    confirmLabel="Hide review"
                    variant="destructive"
                    placeholder="Reason (required, shown to the customer)"
                    onConfirm={async (reason) =>
                      replace(
                        await withAccessToken((t) =>
                          api.admin.hideReview(t, review.id, { reason }),
                        ),
                      )
                    }
                  />
                ) : (
                  <ReasonAction
                    label="Unhide"
                    confirmLabel="Restore review"
                    variant="outline"
                    optional
                    placeholder="Optional note for the audit log"
                    onConfirm={async (note) =>
                      replace(
                        await withAccessToken((t) =>
                          api.admin.unhideReview(t, review.id, note ? { note } : {}),
                        ),
                      )
                    }
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void withAccessToken((t) =>
              api.admin.listReviews(t, { status: status || undefined, limit: 30, cursor }),
            )
              .then((page) => {
                setRows((current) => [...(current ?? []), ...page.data]);
                setCursor(page.nextCursor);
              })
              .catch((caught: unknown) => setError(submitErrorFrom(caught).message))
          }
        >
          Load more
        </Button>
      ) : null}
    </main>
  );
}
