'use client';

import {
  RecoveryCodeSchema,
  TotpCodeSchema,
  isMfaRequiredResponse,
  type MfaMethod,
} from '@vrp/contracts';
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

interface Challenge {
  challengeToken: string;
  methods: MfaMethod[];
  /** Minutes the challenge stays valid, for the hint under the form. */
  minutes: number;
}

type Step = { kind: 'credentials'; notice?: string } | { kind: 'mfa'; challenge: Challenge };

function LoginForm() {
  const { login, api } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'credentials' });

  const flash =
    searchParams.get('verified') === '1'
      ? 'Email verified. You can log in now.'
      : searchParams.get('passwordChanged') === '1'
        ? 'Your password was changed. Please sign in again.'
        : null;
  const nextPath = safeNextPath(searchParams.get('next'));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (isMfaRequiredResponse(result)) {
        // The password is no longer needed; the challenge token carries the first step.
        setPassword('');
        setStep({
          kind: 'mfa',
          challenge: {
            challengeToken: result.challengeToken,
            methods: result.methods,
            minutes: Math.max(1, Math.ceil(result.expiresIn / 60)),
          },
        });
        return;
      }
      router.replace(nextPath);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setError({ message: failure.message, code: failure.code });
    } finally {
      setSubmitting(false);
    }
  }

  if (step.kind === 'mfa') {
    return (
      <MfaStep
        challenge={step.challenge}
        onSuccess={() => router.replace(nextPath)}
        onExpired={(notice) => setStep({ kind: 'credentials', notice })}
        onBack={() => setStep({ kind: 'credentials' })}
      />
    );
  }

  return (
    <AuthCard title="Log in" description="Welcome back.">
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {flash ? <FormMessage>{flash}</FormMessage> : null}
        {step.notice ? <FormMessage variant="destructive">{step.notice}</FormMessage> : null}
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

/** Second step for accounts with an authenticator app (TECH_DECISIONS D67). */
function MfaStep({
  challenge,
  onSuccess,
  onExpired,
  onBack,
}: {
  challenge: Challenge;
  onSuccess: () => void;
  onExpired: (notice: string) => void;
  onBack: () => void;
}) {
  const { completeMfaChallenge, completeMfaRecovery } = useAuth();
  const canUseRecovery = challenge.methods.includes('recovery_code');
  const [method, setMethod] = useState<MfaMethod>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<{ title?: string; message: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (method === 'totp') {
      const parsed = TotpCodeSchema.safeParse(code);
      if (!parsed.success) {
        setError({ message: 'Enter the 6-digit code shown in your authenticator app.' });
        return;
      }
    } else {
      const parsed = RecoveryCodeSchema.safeParse(recoveryCode);
      if (!parsed.success) {
        setError({ message: 'Enter one of your recovery codes, e.g. ABCDE-FGHIJ.' });
        return;
      }
    }
    setSubmitting(true);
    try {
      if (method === 'totp') await completeMfaChallenge(challenge.challengeToken, code.trim());
      else await completeMfaRecovery(challenge.challengeToken, recoveryCode.trim());
      onSuccess();
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      if (failure.code === 'MFA_CHALLENGE_INVALID') {
        onExpired('Your sign-in attempt expired or was already used. Enter your password again.');
        return;
      }
      if (failure.code === 'MFA_LOCKED') {
        setLocked(true);
        setError({ title: 'Too many attempts', message: failure.message });
      } else if (failure.code === 'MFA_CODE_INVALID') {
        setError({
          message:
            method === 'totp'
              ? 'That code was not accepted. Codes change every 30 seconds — enter the one your app shows right now.'
              : 'That recovery code was not accepted. Each code works once; check for typos or try another one.',
        });
      } else {
        setError({ message: failure.message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Two-step verification"
      description={
        method === 'totp'
          ? 'Open your authenticator app and enter the current 6-digit code.'
          : 'Enter one of the recovery codes you saved when you set up two-step verification.'
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error ? (
          <FormMessage variant="destructive" title={error.title}>
            {error.message}
          </FormMessage>
        ) : null}
        {method === 'totp' ? (
          <FormField
            id="mfa-code"
            label="Authenticator code"
            hint="Codes change every 30 seconds; there is nothing to resend."
          >
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={Boolean(error)}
              autoFocus
              required
            />
          </FormField>
        ) : (
          <FormField
            id="mfa-recovery-code"
            label="Recovery code"
            hint="Each recovery code can be used once."
          >
            <Input
              id="mfa-recovery-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={11}
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              aria-invalid={Boolean(error)}
              autoFocus
              required
            />
          </FormField>
        )}
        <Button type="submit" disabled={submitting || locked}>
          {submitting ? 'Verifying…' : 'Verify and log in'}
        </Button>
        <div className="text-muted-foreground grid gap-2 text-sm">
          {canUseRecovery ? (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-start p-0"
              onClick={() => {
                setError(null);
                setMethod(method === 'totp' ? 'recovery_code' : 'totp');
              }}
            >
              {method === 'totp'
                ? 'Use a recovery code instead'
                : 'Use your authenticator app instead'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="link"
            className="h-auto justify-start p-0"
            onClick={onBack}
          >
            Back to password
          </Button>
          <p className="text-xs">
            This step stays open for about {challenge.minutes} minute
            {challenge.minutes === 1 ? '' : 's'}; after that, log in again.
          </p>
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
