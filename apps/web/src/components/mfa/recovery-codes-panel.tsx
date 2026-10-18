'use client';

import { useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadBlob } from '@/lib/blob';
import { formatDateTime } from '@/lib/booking-labels';

interface RecoveryCodesPanelProps {
  codes: string[];
  generatedAt: string;
  /** Called once the user has confirmed the codes are saved. */
  onDone: () => void;
  doneLabel?: string;
}

/**
 * Shows recovery codes exactly once (the API never returns them again) with
 * copy and download helpers and an explicit "I have saved these" confirmation.
 */
export function RecoveryCodesPanel({
  codes,
  generatedAt,
  onDone,
  doneLabel = 'Done',
}: RecoveryCodesPanelProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  const asText = () =>
    [
      'Vehicle Rental Platform — two-step verification recovery codes',
      `Generated ${formatDateTime(generatedAt)} (Sri Lanka time). Each code works once.`,
      '',
      ...codes,
      '',
    ].join('\n');

  return (
    <div className="grid gap-4">
      <FormMessage title="Save these recovery codes now">
        They are shown only once. Each code lets you log in once if you lose access to your
        authenticator app. Keep them somewhere safe and private — not in your e-mail.
      </FormMessage>
      <ol
        className="bg-muted grid grid-cols-2 gap-2 rounded-md p-4 font-mono text-sm"
        aria-label="Recovery codes"
      >
        {codes.map((code) => (
          <li key={code} className="tracking-wide select-all">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join('\n'));
              setCopied('copied');
            } catch {
              setCopied('failed');
            }
          }}
        >
          Copy codes
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadBlob(
              new Blob([asText()], { type: 'text/plain;charset=utf-8' }),
              'vehicle-rental-recovery-codes.txt',
            )
          }
        >
          Download as .txt
        </Button>
        <span className="text-muted-foreground text-xs" role="status">
          {copied === 'copied'
            ? 'Copied to the clipboard.'
            : copied === 'failed'
              ? 'Copying failed; select the codes and copy them manually.'
              : ''}
        </span>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={saved} onCheckedChange={(checked) => setSaved(checked === true)} />
        <span>I have saved these codes somewhere safe.</span>
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
