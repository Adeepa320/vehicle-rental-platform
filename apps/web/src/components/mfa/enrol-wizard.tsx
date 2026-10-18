'use client';

import {
  MfaEnrolStartRequestSchema,
  TotpCodeSchema,
  type MfaEnrolConfirmResponse,
  type MfaEnrolStartResponse,
} from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { QrCode } from '@/components/mfa/qr-code';
import { RecoveryCodesPanel } from '@/components/mfa/recovery-codes-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth/auth-context';
import { submitErrorFrom } from '@/lib/forms';

type Stage =
  | { kind: 'password' }
  | { kind: 'verify'; start: MfaEnrolStartResponse }
  | { kind: 'codes'; result: MfaEnrolConfirmResponse };

/** Groups a base32 secret in blocks of four for reading it into an app by hand. */
const groupSecret = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

interface EnrolWizardProps {
  /** Called after the user confirmed they saved the recovery codes. */
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Password → secret + QR → first code → recovery codes. The secret and the
 * codes are shown once; the upgraded access token from the confirmation is
 * adopted immediately so the console works without logging in again.
 */
export function EnrolWizard({ onComplete, onCancel }: EnrolWizardProps) {
  const { api, withAccessToken, adoptAccessToken } = useAuth();
  const [stage, setStage] = useState<Stage>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = MfaEnrolStartRequestSchema.safeParse({ password });
    if (!parsed.success) {
      setError('Enter your password to continue.');
      return;
    }
    setBusy(true);
    try {
      const started = await withAccessToken((t) => api.mfa.enrolStart(t, parsed.data));
      setPassword('');
      setStage({ kind: 'verify', start: started });
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      if (failure.code === 'MFA_ALREADY_ENROLLED') {
        onComplete();
        return;
      }
      setError(
        failure.code === 'INVALID_CREDENTIALS'
          ? 'The password was not recognised.'
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = TotpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      const result = await withAccessToken((t) => api.mfa.enrolConfirm(t, { code: parsed.data }));
      adoptAccessToken(result.session);
      setCode('');
      setStage({ kind: 'codes', result });
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setError(
        failure.code === 'MFA_CODE_INVALID'
          ? 'That code was not accepted. Codes change every 30 seconds — wait for a new one and try again. Check that your phone’s clock is set automatically.'
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === 'password') {
    return (
      <form className="grid gap-4" onSubmit={(e) => void start(e)} noValidate>
        <p className="text-sm">
          You will need an authenticator app (for example Aegis, Google Authenticator, Microsoft
          Authenticator or 1Password). Confirm your password to begin.
        </p>
        {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
        <FormField id="enrol-password" label="Your password">
          <Input
            id="enrol-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(error)}
            required
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Preparing…' : 'Continue'}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (stage.kind === 'verify') {
    const { start: started } = stage;
    return (
      <form className="grid gap-4" onSubmit={(e) => void confirm(e)} noValidate>
        <ol className="grid gap-4 text-sm">
          <li className="grid gap-2">
            <p className="font-medium">1. Add the account to your authenticator app</p>
            <div className="flex flex-wrap items-start gap-4">
              <QrCode
                value={started.otpauthUri}
                label={`QR code to add ${started.account} at ${started.issuer} to an authenticator app`}
              />
              <div className="grid gap-1">
                <p className="text-muted-foreground">
                  Scan the code, or enter this key manually (time-based, 6 digits, 30 seconds):
                </p>
                <p className="font-mono text-base tracking-wider break-all select-all">
                  {groupSecret(started.secret)}
                </p>
                <p className="text-muted-foreground text-xs">
                  Account: {started.account} · Issuer: {started.issuer}. This key is shown only
                  once.
                </p>
              </div>
            </div>
          </li>
          <li className="grid gap-2">
            <p className="font-medium">2. Enter the code the app shows</p>
            {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
            <FormField id="enrol-code" label="Authenticator code">
              <Input
                id="enrol-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="max-w-xs"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-invalid={Boolean(error)}
                required
              />
            </FormField>
          </li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Turn on two-step verification'}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <FormMessage title="Two-step verification is on">
        Your account is now protected. From the next login you will be asked for a code from your
        authenticator app.
      </FormMessage>
      <RecoveryCodesPanel
        codes={stage.result.recoveryCodes}
        generatedAt={stage.result.generatedAt}
        onDone={onComplete}
        doneLabel="I have saved my codes — finish"
      />
    </div>
  );
}
