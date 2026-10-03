'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const { api } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send you a link to choose a new password."
    >
      {sent ? (
        <div className="grid gap-4 text-sm">
          <FormMessage>
            If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.
          </FormMessage>
          <Link href="/login" className="underline underline-offset-4">
            Back to login
          </Link>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
          <FormField id="email" label="Email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </FormField>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <Link
            href="/login"
            className="text-muted-foreground text-center text-sm underline underline-offset-4"
          >
            Back to login
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
