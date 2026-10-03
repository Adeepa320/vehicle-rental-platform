'use client';

import { PasswordSchema } from '@vrp/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom, type FieldErrors } from '@/lib/forms';

function ResetPasswordForm() {
  const { api } = useAuth();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <AuthCard
        title="Link not valid"
        description="This page needs the link from your reset email."
      >
        <Button nativeButton={false} render={<Link href="/forgot-password" />}>
          Request a new link
        </Button>
      </AuthCard>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = PasswordSchema.safeParse(password);
    const nextErrors: FieldErrors = {};
    if (!parsed.success)
      nextErrors.newPassword = parsed.error.issues[0]?.message ?? 'Invalid password';
    if (password !== confirm) nextErrors.confirm = 'Passwords do not match';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await api.auth.resetPassword(token as string, password);
      setDone(true);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors({
        ...failure.fields,
        ...(failure.fields.password ? { newPassword: failure.fields.password } : {}),
      });
      setMessage(failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        description="All your other sessions have been signed out."
      >
        <Button nativeButton={false} render={<Link href="/login" />}>
          Log in with your new password
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        <FormField
          id="newPassword"
          label="New password"
          error={errors.newPassword}
          hint="At least 10 characters."
        >
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <FormField id="confirm" label="Confirm new password" error={errors.confirm}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthCard title="Choose a new password">Loading…</AuthCard>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
