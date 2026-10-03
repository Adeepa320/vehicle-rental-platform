'use client';

import { useState } from 'react';

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

  if (!open) {
    return (
      <Button
        variant={variant === 'destructive' ? 'outline' : variant}
        size="sm"
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
        onChange={(e) => setText(e.target.value)}
        aria-invalid={Boolean(error)}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
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
