'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';

type State =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'verified'; email: string }
  | { kind: 'failed'; message: string };

function VerifyEmail() {
  const { api } = useAuth();
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>({ kind: token ? 'verifying' : 'idle' });
  const [resendEmail, setResendEmail] = useState('');
  const [resendDone, setResendDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.auth
      .verifyEmail(token)
      .then((result) => {
        if (!cancelled) setState({ kind: 'verified', email: result.email });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'failed', message: submitErrorFrom(error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  async function onResend(event: FormEvent) {
    event.preventDefault();
    await api.auth.resendVerification(resendEmail);
    setResendDone(true);
  }

  if (state.kind === 'verifying') {
    return <AuthCard title="Verifying your email…">One moment.</AuthCard>;
  }

  if (state.kind === 'verified') {
    return (
      <AuthCard title="Email verified" description={`${state.email} is confirmed.`}>
        <Button nativeButton={false} render={<Link href="/login?verified=1" />}>
          Continue to login
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={state.kind === 'failed' ? 'Link not valid' : 'Verify your email'}
      description={
        state.kind === 'failed'
          ? state.message
          : 'Open the verification link from your email, or request a new one below.'
      }
    >
      <form className="grid gap-4" onSubmit={onResend} noValidate>
        {resendDone ? (
          <FormMessage>If an account exists for this email, a new link has been sent.</FormMessage>
        ) : null}
        <FormField id="resendEmail" label="Email">
          <Input
            id="resendEmail"
            type="email"
            autoComplete="email"
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            required
          />
        </FormField>
        <Button type="submit" variant="outline" disabled={resendDone}>
          Send a new verification link
        </Button>
      </form>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthCard title="Verify your email">Loading…</AuthCard>}>
      <VerifyEmail />
    </Suspense>
  );
}
