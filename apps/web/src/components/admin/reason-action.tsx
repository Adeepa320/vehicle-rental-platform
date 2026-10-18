'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { submitErrorFrom } from '@/lib/forms';

interface ReasonActionProps {
  label: string;
  confirmLabel: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary';
  placeholder?: string;
  /** When false (default) the text is required and must be at least 5 characters. */
  optional?: boolean;
  onConfirm: (text: string) => Promise<void>;
}

/** Button that expands into a reason textarea with confirm/cancel; used for admin decisions. */
export function ReasonAction({
  label,
  confirmLabel,
  variant = 'default',
  placeholder,
  optional = false,
  onConfirm,
}: ReasonActionProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  if (!open) {
    return (
      <Button
        variant={variant === 'destructive' ? 'outline' : variant}
        size="sm"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <Textarea
        value={text}
        placeholder={placeholder}
        aria-label={`${label}: ${optional ? 'optional note' : 'reason (required)'}`}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        autoFocus
      />
      {error ? (
        <p id={errorId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={variant}
          disabled={busy || (!optional && text.trim().length < 5)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm(text.trim());
              setOpen(false);
              setText('');
            } catch (caught) {
              setError(submitErrorFrom(caught).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
