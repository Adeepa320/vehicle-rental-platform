'use client';

import type { MfaRecoveryCodes, MfaStatus } from '@vrp/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { AccountNav } from '@/components/account/account-nav';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { AuthCard, FormMessage } from '@/components/auth/form-primitives';
import { EnrolWizard } from '@/components/mfa/enrol-wizard';
import { RecoveryCodesPanel } from '@/components/mfa/recovery-codes-panel';
import { StepUpForm } from '@/components/mfa/step-up-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { isPrivilegedRole } from '@/lib/auth/mfa';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

type Panel = 'none' | 'enrol' | 'regenerate' | 'disable';

export default function SecurityPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-2xl px-4 py-12">
          <p className="text-muted-foreground text-sm" role="status">
            Loading…
          </p>
        </main>
      }
    >
      <SecurityView />
    </Suspense>
  );
}

function SecurityView() {
  const gate = useRequireAuth();
  const { api, user, withAccessToken, clearMfaRequirement, logout, changePassword } = useAuth();
  const router = useRouter();
  const fromAdmin = useSearchParams().get('reason') === 'mfa';
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [freshCodes, setFreshCodes] = useState<MfaRecoveryCodes | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (gate !== 'ready') return;
    let cancelled = false;
    withAccessToken((t) => api.mfa.status(t))
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, reloadKey, withAccessToken]);

  const reload = () => {
    setStatus(null);
    setReloadKey((k) => k + 1);
  };

  if (gate !== 'ready' || !user) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <p className="text-muted-foreground text-sm" role="status">
          Loading your account…
        </p>
      </main>
    );
  }

  const available = isPrivilegedRole(user.roles) || (status?.required ?? false);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <AccountNav />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm">
          Your password, and two-step verification with an authenticator app for privileged
          accounts.
        </p>
      </header>

      <AuthCard
        title="Change password"
        description="Enter your current password, then choose a new one."
      >
        <ChangePasswordForm onSubmit={changePassword} />
      </AuthCard>

      {fromAdmin ? (
        <FormMessage title="Admin features need two-step verification">
          Your account has an administrator role, so the console only works once an authenticator
          app is set up and this session has been verified with it. Set it up below; afterwards you
          can go back to the{' '}
          <Link href="/admin" className="underline underline-offset-4">
            admin console
          </Link>
          .
        </FormMessage>
      ) : null}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {notice ? <FormMessage>{notice}</FormMessage> : null}

      {!available ? (
        <AuthCard title="Two-step verification">
          <p className="text-muted-foreground text-sm">Not available for your account.</p>
        </AuthCard>
      ) : !status ? (
        <AuthCard title="Two-step verification">
          <p className="text-muted-foreground text-sm" role="status">
            Checking your settings…
          </p>
        </AuthCard>
      ) : (
        <>
          <AuthCard
            title="Two-step verification"
            description="A 6-digit code from your authenticator app is required at login."
          >
            <div className="grid gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.enrolled ? 'default' : 'destructive'}>
                  {status.enrolled ? 'On' : 'Off'}
                </Badge>
                {status.required ? <Badge variant="outline">Required for your role</Badge> : null}
                {status.enrolled ? (
                  <Badge variant={status.sessionVerified ? 'secondary' : 'destructive'}>
                    {status.sessionVerified ? 'This session is verified' : 'Session not verified'}
                  </Badge>
                ) : null}
              </div>
              {status.enrolled ? (
                <dl className="grid gap-1 sm:grid-cols-[200px_1fr]">
                  <dt className="text-muted-foreground">Set up</dt>
                  <dd>{formatDateTime(status.confirmedAt)}</dd>
                  <dt className="text-muted-foreground">Recovery codes left</dt>
                  <dd>{status.recoveryCodesRemaining}</dd>
                </dl>
              ) : status.pendingEnrolment ? (
                <p className="text-muted-foreground">
                  A set-up was started but never confirmed with a code. Starting again issues a new
                  key; the old one stops working.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Not set up yet.{' '}
                  {status.required
                    ? 'Admin features stay unavailable until it is.'
                    : 'Recommended for every privileged account.'}
                </p>
              )}
              {status.enrolled && !status.sessionVerified ? (
                <FormMessage title="This session predates two-step verification">
                  Admin features need a session that completed the second step. Log in again to
                  verify.{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={async () => {
                      await logout();
                      router.push('/login?next=/admin');
                    }}
                  >
                    Sign in again
                  </Button>
                </FormMessage>
              ) : null}
              {status.enrolled && status.recoveryCodesRemaining <= 2 ? (
                <FormMessage variant="destructive" title="Few recovery codes left">
                  Generate a new set before you run out; the old codes stop working.
                </FormMessage>
              ) : null}
              {panel === 'none' ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {!status.enrolled ? (
                    <Button size="sm" onClick={() => setPanel('enrol')}>
                      {status.pendingEnrolment ? 'Start set-up again' : 'Set up authenticator app'}
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setPanel('regenerate')}>
                        New recovery codes
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPanel('disable')}>
                        Turn off
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </AuthCard>

          {panel === 'enrol' ? (
            <AuthCard title="Set up your authenticator app">
              <EnrolWizard
                onComplete={() => {
                  clearMfaRequirement();
                  setPanel('none');
                  setNotice(
                    fromAdmin
                      ? 'Two-step verification is on and this session is verified. You can return to the admin console.'
                      : 'Two-step verification is on.',
                  );
                  reload();
                }}
                onCancel={() => setPanel('none')}
              />
            </AuthCard>
          ) : null}

          {panel === 'regenerate' ? (
            <AuthCard
              title="New recovery codes"
              description="Replaces every existing recovery code. Confirm with your password and a current code."
            >
              {freshCodes ? (
                <RecoveryCodesPanel
                  codes={freshCodes.recoveryCodes}
                  generatedAt={freshCodes.generatedAt}
                  onDone={() => {
                    setFreshCodes(null);
                    setPanel('none');
                    reload();
                  }}
                />
              ) : (
                <StepUpForm
                  idPrefix="regen"
                  submitLabel="Generate new codes"
                  busyLabel="Generating…"
                  onSubmit={async (body) =>
                    setFreshCodes(
                      await withAccessToken((t) => api.mfa.regenerateRecoveryCodes(t, body)),
                    )
                  }
                  onCancel={() => setPanel('none')}
                />
              )}
            </AuthCard>
          ) : null}

          {panel === 'disable' ? (
            <AuthCard title="Turn off two-step verification">
              <div className="grid gap-4">
                <FormMessage variant="destructive" title="Admin features will stop working">
                  Your account will be protected by the password alone, and the admin console
                  refuses privileged actions until you set up an authenticator app again.
                </FormMessage>
                <StepUpForm
                  idPrefix="disable"
                  submitLabel="Turn off two-step verification"
                  busyLabel="Turning off…"
                  variant="destructive"
                  onSubmit={async (body) => {
                    await withAccessToken((t) => api.mfa.disable(t, body));
                    setPanel('none');
                    setNotice('Two-step verification is off.');
                    reload();
                  }}
                  onCancel={() => setPanel('none')}
                />
              </div>
            </AuthCard>
          ) : null}
        </>
      )}
    </main>
  );
}
