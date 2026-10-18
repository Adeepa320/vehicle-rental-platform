'use client';

import { CreateDeletionRequestSchema, type PrivacyRequest } from '@vrp/contracts';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { AccountNav } from '@/components/account/account-nav';
import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { downloadBlob } from '@/lib/blob';
import { formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import {
  PRIVACY_BLOCKER_EXPLANATION,
  PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_TYPE_LABEL,
} from '@/lib/privacy-labels';

const todayStamp = () => new Date().toISOString().slice(0, 10);

export default function PrivacyPage() {
  const gate = useRequireAuth();
  const { api, user, withAccessToken } = useAuth();
  const [requests, setRequests] = useState<PrivacyRequest[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (gate !== 'ready') return;
    let cancelled = false;
    withAccessToken((t) => api.users.privacyRequests(t))
      .then((result) => {
        if (!cancelled) setRequests(result.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setListError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, reloadKey, withAccessToken]);

  if (gate !== 'ready' || !user) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <p className="text-muted-foreground text-sm" role="status">
          Loading your account…
        </p>
      </main>
    );
  }

  const hasOpenRequest =
    requests?.some(
      (r) => r.type === 'deletion' && (r.status === 'open' || r.status === 'in_review'),
    ) ?? false;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12">
      <AccountNav />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy and data</h1>
        <p className="text-muted-foreground text-sm">
          Get a copy of the personal data we hold about you, or ask us to delete your account. How
          we handle data is described in the{' '}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Notice
          </Link>
          .
        </p>
      </header>

      <ExportCard onDownload={() => withAccessToken((t) => api.users.exportData(t))} />

      <DeletionCard
        email={user.email}
        disabled={hasOpenRequest}
        onSubmit={async (body) => {
          const created = await withAccessToken((t) => api.users.requestDeletion(t, body));
          setReloadKey((k) => k + 1);
          return created;
        }}
      />

      <AuthCard title="Your requests" description="Everything you have asked us for, newest first.">
        {listError ? <FormMessage variant="destructive">{listError}</FormMessage> : null}
        {!requests ? (
          <p className="text-muted-foreground text-sm" role="status">
            Loading…
          </p>
        ) : requests.length === 0 ? (
          <p className="text-muted-foreground text-sm">No requests yet.</p>
        ) : (
          <ul className="grid gap-3">
            {requests.map((request) => (
              <RequestItem key={request.id} request={request} />
            ))}
          </ul>
        )}
      </AuthCard>
    </main>
  );
}

function ExportCard({ onDownload }: { onDownload: () => Promise<Blob> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    variant: 'default' | 'destructive';
    text: string;
  } | null>(null);
  return (
    <AuthCard
      title="Download my data"
      description="A JSON file with your account, bookings, payments, reviews, disputes and notifications. Other people’s personal details are not included."
    >
      <div className="grid gap-3">
        {message ? <FormMessage variant={message.variant}>{message.text}</FormMessage> : null}
        <div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMessage(null);
              try {
                const blob = await onDownload();
                downloadBlob(blob, `my-data-${todayStamp()}.json`);
                setMessage({ variant: 'default', text: 'Your data file has been downloaded.' });
              } catch (caught) {
                setMessage({ variant: 'destructive', text: submitErrorFrom(caught).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Preparing your file…' : 'Download my data (.json)'}
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}

function DeletionCard({
  email,
  disabled,
  onSubmit,
}: {
  email: string;
  disabled: boolean;
  onSubmit: (body: { confirmEmail: string; note?: string }) => Promise<PrivacyRequest>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<PrivacyRequest | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = CreateDeletionRequestSchema.safeParse({
      confirmEmail,
      note: note.trim() === '' ? undefined : note.trim(),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    if (parsed.data.confirmEmail !== email.toLowerCase()) {
      setErrors({ confirmEmail: 'Type the e-mail address of this account exactly.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const created = await onSubmit(parsed.data);
      setResult(created);
      setOpen(false);
      setConfirmEmail('');
      setNote('');
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(
        failure.code === 'PRIVACY_REQUEST_ALREADY_OPEN'
          ? 'You already have a deletion request in progress; see “Your requests” below.'
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Request account deletion"
      description="Our team reviews every request. Personal data is replaced with neutral values; bookings and payments are kept for the legal retention period."
    >
      <div className="grid gap-3">
        {result ? (
          <FormMessage title="Request received">
            We received your deletion request on {formatDateTime(result.requestedAt)} (Sri Lanka
            time). Our team will review it and you will be notified when it is completed.
            {result.blockers.length > 0 ? (
              <>
                {' '}
                Right now the following prevents deletion:
                <ul className="mt-2 list-disc pl-5">
                  {result.blockers.map((blocker) => (
                    <li key={blocker}>{PRIVACY_BLOCKER_EXPLANATION[blocker]}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </FormMessage>
        ) : null}
        {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
        {disabled ? (
          <p className="text-muted-foreground text-sm">
            A deletion request is already in progress; see “Your requests” below.
          </p>
        ) : !open ? (
          <div>
            <Button variant="destructive" onClick={() => setOpen(true)}>
              Request account deletion
            </Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <FormField
              id="confirmEmail"
              label="Type your e-mail address to confirm"
              error={errors.confirmEmail}
              hint={email}
            >
              <Input
                id="confirmEmail"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                aria-invalid={Boolean(errors.confirmEmail)}
                required
              />
            </FormField>
            <FormField
              id="deletion-note"
              label="Anything we should know? (optional)"
              error={errors.note}
            >
              <Textarea
                id="deletion-note"
                className="min-h-16"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy ? 'Sending…' : 'Send deletion request'}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </AuthCard>
  );
}

function RequestItem({ request }: { request: PrivacyRequest }) {
  const status = PRIVACY_REQUEST_STATUS[request.status];
  const isOpen = request.status === 'open' || request.status === 'in_review';
  return (
    <li className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{PRIVACY_REQUEST_TYPE_LABEL[request.type]}</span>
        <Badge variant={status.tone}>{status.label}</Badge>
      </div>
      <p className="text-muted-foreground text-xs">
        Requested {formatDateTime(request.requestedAt)}
        {request.acknowledgedAt ? ` · picked up ${formatDateTime(request.acknowledgedAt)}` : ''}
        {request.completedAt ? ` · completed ${formatDateTime(request.completedAt)}` : ''}
        {request.rejectedAt ? ` · closed ${formatDateTime(request.rejectedAt)}` : ''}
      </p>
      <p className="text-muted-foreground">{status.description}</p>
      {isOpen && request.type === 'deletion' && request.blockers.length > 0 ? (
        <div>
          <p className="font-medium">What is holding this up</p>
          <ul className="list-disc pl-5">
            {request.blockers.map((blocker) => (
              <li key={blocker}>{PRIVACY_BLOCKER_EXPLANATION[blocker]}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {request.publicNote ? (
        <p>
          <span className="text-muted-foreground">Note from the team:</span>{' '}
          <span className="whitespace-pre-wrap">{request.publicNote}</span>
        </p>
      ) : null}
    </li>
  );
}
