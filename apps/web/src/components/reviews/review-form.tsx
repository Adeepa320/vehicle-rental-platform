'use client';

import {
  CreateReviewRequestSchema,
  REVIEW_COMMENT_MAX,
  type CreateReviewRequest,
  type CustomerReview,
} from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { StarInput } from '@/components/reviews/rating-stars';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

interface ReviewFormProps {
  existing: CustomerReview | null;
  onSubmit: (body: CreateReviewRequest) => Promise<CustomerReview>;
  onSaved: (review: CustomerReview) => void;
}

/** Create or edit the customer's review: overall rating required, sub-ratings and comment optional. */
export function ReviewForm({ existing, onSubmit, onSaved }: ReviewFormProps) {
  const [overall, setOverall] = useState<number | null>(existing?.overallRating ?? null);
  const [vehicle, setVehicle] = useState<number | null>(existing?.vehicleRating ?? null);
  const [service, setService] = useState<number | null>(existing?.serviceRating ?? null);
  const [communication, setCommunication] = useState<number | null>(
    existing?.communicationRating ?? null,
  );
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = CreateReviewRequestSchema.safeParse({
      overallRating: overall,
      ...(vehicle !== null ? { vehicleRating: vehicle } : {}),
      ...(service !== null ? { serviceRating: service } : {}),
      ...(communication !== null ? { communicationRating: communication } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      if (overall === null) setMessage('Choose an overall rating from 1 to 5 stars.');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onSaved(await onSubmit(parsed.data));
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setMessage(
        failure.code === 'REVIEW_WINDOW_CLOSED'
          ? 'The review period for this booking has closed.'
          : failure.code === 'ALREADY_REVIEWED'
            ? 'You have already reviewed this booking; reload the page to edit it.'
            : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <StarInput name="overall" label="Overall rating" value={overall} onChange={setOverall} />
      {errors.overallRating ? (
        <p className="text-destructive text-xs">{errors.overallRating}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StarInput name="vehicle" label="Vehicle" value={vehicle} onChange={setVehicle} optional />
        <StarInput name="service" label="Service" value={service} onChange={setService} optional />
        <StarInput
          name="communication"
          label="Communication"
          value={communication}
          onChange={setCommunication}
          optional
        />
      </div>
      <FormField
        id="review-comment"
        label="Comment (optional)"
        error={errors.comment}
        hint={`Up to ${REVIEW_COMMENT_MAX} characters. Shown publicly with your first name and last initial; please do not include phone numbers or e-mail addresses.`}
      >
        <Textarea
          id="review-comment"
          className="min-h-24"
          maxLength={REVIEW_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </FormField>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Publish review'}
        </Button>
      </div>
    </form>
  );
}
