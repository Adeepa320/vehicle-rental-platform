'use client';

import { ChangePasswordRequestSchema } from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

interface ChangePasswordFormProps {
  /** Sends the change; resolves once the server has signed every session out (the auth gate then redirects). */
  onSubmit: (body: { currentPassword: string; newPassword: string }) => Promise<void>;
}

/**
 * Signed-in password change (ASVS V6.2.3). Values live in component state only —
 * never in the URL or browser storage — and are dropped after every attempt that
 * reached the server. Policy errors come from the API, which applies the same
 * rules as registration and reset.
 */
export function ChangePasswordForm({ onSubmit }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    const nextErrors: FieldErrors = parsed.success ? {} : fieldErrorsFromZod(parsed.error);
    if (newPassword !== confirm) nextErrors.confirm = 'Passwords do not match';
    if (!parsed.success || nextErrors.confirm) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(
        failure.code === 'CURRENT_PASSWORD_INVALID'
          ? 'Your current password was not recognised.'
          : failure.code === 'VALIDATION_ERROR'
            ? 'Please check the highlighted fields.'
            : failure.message,
      );
      setCurrentPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <FormField id="current-password" label="Current password" error={errors.currentPassword}>
        <Input
          id="current-password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          aria-invalid={Boolean(errors.currentPassword)}
          aria-describedby={errors.currentPassword ? 'current-password-error' : undefined}
          required
        />
      </FormField>
      <FormField
        id="new-password"
        label="New password"
        error={errors.newPassword}
        hint="At least 10 characters. Avoid common passwords and your name or e-mail."
      >
        <Input
          id="new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-invalid={Boolean(errors.newPassword)}
          aria-describedby={errors.newPassword ? 'new-password-error' : 'new-password-hint'}
          required
        />
      </FormField>
      <FormField id="confirm-password" label="Confirm new password" error={errors.confirm}>
        <Input
          id="confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={Boolean(errors.confirm)}
          aria-describedby={errors.confirm ? 'confirm-password-error' : undefined}
          required
        />
      </FormField>
      <p className="text-muted-foreground text-xs">
        Changing your password signs you out everywhere, including this browser.
      </p>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Changing password…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}
