'use client';

import { MfaStepUpRequestSchema, type MfaStepUpRequest } from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

interface StepUpFormProps {
  /** Prefix for input ids so two forms can share a page. */
  idPrefix: string;
  submitLabel: string;
  busyLabel: string;
  variant?: 'default' | 'destructive';
  onSubmit: (body: MfaStepUpRequest) => Promise<void>;
  onCancel: () => void;
}

/** Password + current authenticator code; used to disable MFA or regenerate recovery codes. */
export function StepUpForm({
  idPrefix,
  submitLabel,
  busyLabel,
  variant = 'default',
  onSubmit,
  onCancel,
}: StepUpFormProps) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = MfaStepUpRequestSchema.safeParse({ password, code });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(
        failure.code === 'MFA_CODE_INVALID'
          ? 'That code was not accepted. Codes change every 30 seconds — enter the current one.'
          : failure.code === 'INVALID_CREDENTIALS'
            ? 'The password was not recognised.'
            : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <FormField id={`${idPrefix}-password`} label="Your password" error={errors.password}>
        <Input
          id={`${idPrefix}-password`}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(errors.password)}
          required
        />
      </FormField>
      <FormField
        id={`${idPrefix}-code`}
        label="Current authenticator code"
        error={errors.code}
        hint="The 6 digits your app shows right now."
      >
        <Input
          id={`${idPrefix}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-invalid={Boolean(errors.code)}
          required
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={variant} disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
