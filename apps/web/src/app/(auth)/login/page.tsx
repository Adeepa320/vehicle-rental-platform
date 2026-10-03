'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';

function safeNextPath(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account';
}

function LoginForm() {
  const { login, api } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  const flash = searchParams.get('verified') === '1' ? 'Email verified. You can log in now.' : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(safeNextPath(searchParams.get('next')));
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setError({ message: failure.message, code: failure.code });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Log in" description="Welcome back.">
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {flash ? <FormMessage>{flash}</FormMessage> : null}
        {error ? (
          <FormMessage variant="destructive">
            {error.message}
            {error.code === 'EMAIL_NOT_VERIFIED' ? (
              <Button
                variant="link"
                className="h-auto p-0 pl-1"
                disabled={resent}
                onClick={async () => {
                  await api.auth.resendVerification(email);
                  setResent(true);
                }}
              >
                {resent ? 'Link sent.' : 'Resend verification link'}
              </Button>
            ) : null}
          </FormMessage>
        ) : null}
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
        <FormField id="password" label="Password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </FormField>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
        <div className="text-muted-foreground flex justify-between text-sm">
          <Link href="/forgot-password" className="underline underline-offset-4">
            Forgot password?
          </Link>
          <Link href="/register" className="underline underline-offset-4">
            Create account
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthCard title="Log in">Loading…</AuthCard>}>
      <LoginForm />
    </Suspense>
  );
}
