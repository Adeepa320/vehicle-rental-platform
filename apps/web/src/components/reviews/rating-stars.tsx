import type { RatingSummary } from '@vrp/contracts';

/** Read-only stars for a 1–5 rating. */
export function Stars({ value, label }: { value: number; label?: string }) {
  const rounded = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      className="text-amber-500"
      role="img"
      aria-label={label ?? `${value} out of 5 stars`}
      title={`${value} / 5`}
    >
      {'★'.repeat(rounded)}
      <span className="text-muted-foreground/50">{'☆'.repeat(5 - rounded)}</span>
    </span>
  );
}

/** "★ 4.5 · 12 reviews" or an honest empty state; never a manufactured score. */
export function RatingSummaryLine({
  summary,
  compact = false,
}: {
  summary: RatingSummary;
  compact?: boolean;
}) {
  if (summary.count === 0 || summary.average === null) {
    return compact ? null : <span className="text-muted-foreground text-sm">No reviews yet</span>;
  }
  const reviews = `${summary.count} review${summary.count === 1 ? '' : 's'}`;
  return (
    <span
      className="inline-flex items-center gap-1 text-sm"
      title={`${summary.average} out of 5 from ${reviews}`}
    >
      <span className="text-amber-500" aria-hidden>
        ★
      </span>
      <span className="font-medium">{summary.average}</span>
      <span className="text-muted-foreground">· {reviews}</span>
    </span>
  );
}

/** Keyboard-friendly star picker (radio group) for review forms. */
export function StarInput({
  name,
  label,
  value,
  onChange,
  optional = false,
}: {
  name: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  optional?: boolean;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-medium">
        {label}
        {optional ? <span className="text-muted-foreground font-normal"> (optional)</span> : null}
      </legend>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer text-2xl leading-none">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            <span
              className={
                value !== null && n <= value ? 'text-amber-500' : 'text-muted-foreground/40'
              }
            >
              ★
            </span>
            <span className="sr-only">
              {n} star{n === 1 ? '' : 's'}
            </span>
          </label>
        ))}
        {optional && value !== null ? (
          <button
            type="button"
            className="text-muted-foreground ml-2 text-xs underline"
            onClick={() => onChange(null)}
          >
            clear
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
