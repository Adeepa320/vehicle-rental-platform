import type { PublicReview } from '@vrp/contracts';

import { Stars } from '@/components/reviews/rating-stars';
import { formatDay } from '@/lib/vehicle-labels';

/**
 * One published review. Text comes from the API as plain strings and is
 * rendered as text (React escapes it), so a comment containing markup is shown
 * verbatim, never executed.
 */
export function ReviewCard({
  review,
  providerName,
}: {
  review: PublicReview;
  providerName?: string;
}) {
  const sub = [
    ['Vehicle', review.vehicleRating],
    ['Service', review.serviceRating],
    ['Communication', review.communicationRating],
  ].filter((entry): entry is [string, number] => entry[1] !== null);
  return (
    <article className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars value={review.overallRating} />
          <span className="font-medium">{review.reviewer.displayName}</span>
        </div>
        <span className="text-muted-foreground text-xs">
          {formatDay(review.createdAt)}
          {review.updatedAt !== review.createdAt ? ' · edited' : ''}
        </span>
      </div>
      {sub.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {sub.map(([label, value]) => `${label} ${value}/5`).join(' · ')}
        </p>
      ) : null}
      {review.comment ? <p className="whitespace-pre-wrap">{review.comment}</p> : null}
      {review.providerReply ? (
        <div className="bg-muted/50 rounded-md border-l-2 p-2">
          <p className="text-muted-foreground text-xs">
            Reply from {providerName ?? 'the provider'}
            {review.providerRepliedAt ? ` · ${formatDay(review.providerRepliedAt)}` : ''}
          </p>
          <p className="whitespace-pre-wrap">{review.providerReply}</p>
        </div>
      ) : null}
    </article>
  );
}
