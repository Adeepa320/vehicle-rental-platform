'use client';

import { DISPUTE_MESSAGE_MAX, type DisputeMessage } from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

interface DisputeThreadProps {
  messages: DisputeMessage[];
  /** Whether the viewer may post right now. */
  canMessage: boolean;
  /** Posts a public message; the caller replaces its dispute with the result. */
  onSend: (body: string) => Promise<void>;
  /** Shown above the form, e.g. who will see the message. */
  formHint?: string;
  closedNote?: string;
}

/** Append-only dispute thread plus the message form; shared by participants and admins. */
export function DisputeThread({
  messages,
  canMessage,
  onSend,
  formHint,
  closedNote,
}: DisputeThreadProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (text.length === 0 || text.length > DISPUTE_MESSAGE_MAX) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(text);
      setBody('');
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">No messages yet.</p>
      ) : (
        <ol className="grid gap-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`rounded-md border p-3 text-sm ${
                message.authorRole === 'admin' ? 'bg-muted/40' : ''
              }`}
            >
              <p className="text-muted-foreground mb-1 text-xs">
                <span className="text-foreground font-medium">{message.authorName}</span> ·{' '}
                {message.authorRole === 'admin' ? 'platform team' : message.authorRole} ·{' '}
                {formatDateTime(message.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {canMessage ? (
        <form className="grid gap-3" onSubmit={(e) => void submit(e)} noValidate>
          {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
          <FormField
            id="dispute-message"
            label="Add a message"
            hint={
              formHint ??
              `Visible to both parties and the platform team. Up to ${DISPUTE_MESSAGE_MAX} characters.`
            }
          >
            <Textarea
              id="dispute-message"
              className="min-h-20"
              maxLength={DISPUTE_MESSAGE_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>
          <div>
            <Button type="submit" size="sm" disabled={busy || body.trim().length === 0}>
              {busy ? 'Sending…' : 'Send message'}
            </Button>
          </div>
        </form>
      ) : closedNote ? (
        <p className="text-muted-foreground text-sm">{closedNote}</p>
      ) : null}
    </div>
  );
}
