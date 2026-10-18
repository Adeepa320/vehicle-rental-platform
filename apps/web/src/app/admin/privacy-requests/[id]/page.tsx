'use client';

import {
  AdminPrivacyRequestCompleteAccessSchema,
  AdminPrivacyRequestCompleteDeletionSchema,
  AdminPrivacyRequestRejectSchema,
  PRIVACY_REQUEST_OPEN_STATUSES,
  type AdminPrivacyRequest,
} from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminShell, DetailRows } from '@/components/admin/admin-shell';
import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ANONYMISATION_BLOCKER_LABEL, USER_STATUS } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { downloadBlob } from '@/lib/blob';
import { formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE_LABEL } from '@/lib/privacy-labels';

export default function AdminPrivacyRequestDetailPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const params = useParams<{ id: string }>();
  const [request, setRequest] = useState<AdminPrivacyRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.getPrivacyRequest(t, params.id))
      .then((result) => {
        if (!cancelled) setRequest(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, params.id, ready, withAccessToken]);

  return (
    <AdminShell area={area} width="max-w-4xl">
      <Link
        href="/admin/privacy-requests"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← All privacy requests
      </Link>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {!request ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading request…
        </p>
      ) : (
        <RequestDetail request={request} onChanged={setRequest} />
      )}
    </AdminShell>
  );
}

function RequestDetail({
  request,
  onChanged,
}: {
  request: AdminPrivacyRequest;
  onChanged: (request: AdminPrivacyRequest) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const status = PRIVACY_REQUEST_STATUS[request.status];
  const isOpen = PRIVACY_REQUEST_OPEN_STATUSES.includes(request.status);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  return (
    <>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {PRIVACY_REQUEST_TYPE_LABEL[request.type]} request
          </h1>
          <Badge variant={status.tone}>{status.label}</Badge>
          <Badge variant="outline">
            {request.source === 'self' ? 'From the account holder' : 'Recorded by an admin'}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Requested {formatDateTime(request.requestedAt)} · last change{' '}
          {formatDateTime(request.updatedAt)}
          {request.handledBy ? ` · handled by ${request.handledBy.email}` : ''}
        </p>
      </header>

      {request.publicNote ? (
        <FormMessage title="Note shown to the requester">
          <p className="whitespace-pre-wrap">{request.publicNote}</p>
        </FormMessage>
      ) : null}
      {actionError ? <FormMessage variant="destructive">{actionError}</FormMessage> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <AuthCard title="Account">
          <DetailRows
            rows={[
              [
                'Name',
                <Link
                  key="u"
                  href={`/admin/users/${request.user.id}`}
                  className="underline underline-offset-4"
                >
                  {request.user.fullName}
                </Link>,
              ],
              ['E-mail', request.user.email],
              ['Status', USER_STATUS[request.user.status].label],
              ['Roles', request.user.roles.join(', ') || '—'],
            ]}
          />
        </AuthCard>
        <AuthCard title="Timeline">
          <DetailRows
            rows={[
              ['Requested', formatDateTime(request.requestedAt)],
              ['Review started', formatDateTime(request.acknowledgedAt)],
              ['Completed', formatDateTime(request.completedAt)],
              ['Rejected', formatDateTime(request.rejectedAt)],
            ]}
          />
        </AuthCard>
      </div>

      <AuthCard title="What the requester wrote">
        <p className="text-sm whitespace-pre-wrap">
          {request.requesterNote ?? <span className="text-muted-foreground">No note.</span>}
        </p>
      </AuthCard>

      {request.type === 'deletion' && isOpen ? (
        <AuthCard
          title="Deletion blockers"
          description="Anonymisation is refused while any of these apply; they are re-checked when you complete the request."
        >
          {request.blockers.length === 0 ? (
            <p className="text-sm">None — the account can be anonymised now.</p>
          ) : (
            <ul className="grid gap-1 pl-5 text-sm [list-style:disc]">
              {request.blockers.map((blocker) => (
                <li key={blocker}>{ANONYMISATION_BLOCKER_LABEL[blocker]}</li>
              ))}
            </ul>
          )}
        </AuthCard>
      ) : null}

      <InternalNoteCard request={request} onChanged={onChanged} />

      <AuthCard
        title="Data export"
        description="The same allow-listed JSON the account holder can download. Every admin download is audited."
      >
        <Button
          size="sm"
          variant="outline"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            setActionError(null);
            try {
              const blob = await withAccessToken((t) =>
                api.admin.privacyRequestExport(t, request.id),
              );
              downloadBlob(blob, `privacy-request-${request.id}-export.json`);
            } catch (caught) {
              setActionError(submitErrorFrom(caught).message);
            } finally {
              setDownloading(false);
            }
          }}
        >
          {downloading ? 'Preparing…' : 'Download export (.json)'}
        </Button>
      </AuthCard>

      <AuthCard
        title="Decision"
        description="Start the review to take ownership, then complete or reject the request. The requester is notified."
      >
        {!isOpen ? (
          <p className="text-muted-foreground text-sm">This request is closed.</p>
        ) : (
          <div className="grid gap-4">
            {request.status === 'open' ? (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setActionError(null);
                    try {
                      onChanged(
                        await withAccessToken((t) =>
                          api.admin.startPrivacyRequestReview(t, request.id),
                        ),
                      );
                    } catch (caught) {
                      setActionError(submitErrorFrom(caught).message);
                    }
                  }}
                >
                  Start review
                </Button>
              </div>
            ) : null}
            <DecisionForm request={request} onChanged={onChanged} />
          </div>
        )}
      </AuthCard>
    </>
  );
}

function InternalNoteCard({
  request,
  onChanged,
}: {
  request: AdminPrivacyRequest;
  onChanged: (request: AdminPrivacyRequest) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [note, setNote] = useState(request.internalNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <AuthCard
      title="Internal note"
      description="Never shown to the requester. Replaces the previous note."
    >
      <form
        className="grid gap-3"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setSaved(false);
          try {
            onChanged(
              await withAccessToken((t) =>
                api.admin.setPrivacyRequestInternalNote(t, request.id, { note: note.trim() }),
              ),
            );
            setSaved(true);
          } catch (caught) {
            setError(submitErrorFrom(caught).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
        <label className="sr-only" htmlFor="internal-note">
          Internal note
        </label>
        <Textarea
          id="internal-note"
          className="min-h-20"
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? 'Saving…' : 'Save internal note'}
          </Button>
          <span className="text-muted-foreground text-xs" role="status">
            {saved ? 'Saved.' : ''}
          </span>
        </div>
      </form>
    </AuthCard>
  );
}

type Mode = 'complete' | 'reject';

function DecisionForm({
  request,
  onChanged,
}: {
  request: AdminPrivacyRequest;
  onChanged: (request: AdminPrivacyRequest) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [mode, setMode] = useState<Mode>('complete');
  const [publicNote, setPublicNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isDeletion = request.type === 'deletion';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
    setBusy(true);
    try {
      if (mode === 'reject') {
        const parsed = AdminPrivacyRequestRejectSchema.safeParse({
          publicNote: publicNote.trim(),
          internalNote: optional(internalNote),
        });
        if (!parsed.success) {
          setErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        setErrors({});
        onChanged(
          await withAccessToken((t) => api.admin.rejectPrivacyRequest(t, request.id, parsed.data)),
        );
      } else if (isDeletion) {
        const parsed = AdminPrivacyRequestCompleteDeletionSchema.safeParse({
          reason: reason.trim(),
          confirmEmail: confirmEmail.trim(),
          publicNote: optional(publicNote),
          internalNote: optional(internalNote),
        });
        if (!parsed.success) {
          setErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        if (parsed.data.confirmEmail !== request.user.email.toLowerCase()) {
          setErrors({ confirmEmail: 'Type the account’s e-mail address exactly.' });
          return;
        }
        setErrors({});
        onChanged(
          await withAccessToken((t) =>
            api.admin.completePrivacyDeletionRequest(t, request.id, parsed.data),
          ),
        );
      } else {
        const parsed = AdminPrivacyRequestCompleteAccessSchema.safeParse({
          publicNote: publicNote.trim(),
          internalNote: optional(internalNote),
        });
        if (!parsed.success) {
          setErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        setErrors({});
        onChanged(
          await withAccessToken((t) =>
            api.admin.completePrivacyAccessRequest(t, request.id, parsed.data),
          ),
        );
      }
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(
        failure.code === 'ACCOUNT_ANONYMISATION_BLOCKED'
          ? `${failure.message} Resolve the blockers listed above first.`
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-md border p-3" onSubmit={(e) => void submit(e)} noValidate>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <div className="flex gap-2" role="group" aria-label="Decision type">
        <Button
          type="button"
          size="sm"
          variant={mode === 'complete' ? 'default' : 'outline'}
          aria-pressed={mode === 'complete'}
          onClick={() => setMode('complete')}
        >
          {isDeletion ? 'Complete deletion' : 'Complete access request'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'reject' ? 'default' : 'outline'}
          aria-pressed={mode === 'reject'}
          onClick={() => setMode('reject')}
        >
          Reject
        </Button>
      </div>

      {mode === 'complete' && isDeletion ? (
        <>
          <FormMessage variant="destructive" title="This cannot be undone">
            Completing the request anonymises the account now: personal data is replaced with
            neutral values and the person can no longer log in. Bookings and payments are kept for
            the retention period. The request is refused while a blocker applies.
          </FormMessage>
          <FormField
            id="deletion-reason"
            label="Reason (audit log, 5–500 characters)"
            error={errors.reason}
          >
            <Textarea
              id="deletion-reason"
              className="min-h-16"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={Boolean(errors.reason)}
            />
          </FormField>
          <FormField
            id="deletion-confirm-email"
            label="Type the account’s e-mail address to confirm"
            error={errors.confirmEmail}
            hint={request.user.email}
          >
            <Input
              id="deletion-confirm-email"
              type="email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              aria-invalid={Boolean(errors.confirmEmail)}
            />
          </FormField>
        </>
      ) : null}

      <FormField
        id="decision-public-note"
        label={
          mode === 'complete' && isDeletion
            ? 'Note to the requester (optional, 10–2000 characters)'
            : 'Note to the requester (10–2000 characters)'
        }
        error={errors.publicNote}
        hint={
          mode === 'reject'
            ? 'Explain why the request cannot be actioned.'
            : isDeletion
              ? 'Sent with the completion notice.'
              : 'For example how and when the export was handed over.'
        }
      >
        <Textarea
          id="decision-public-note"
          className="min-h-20"
          maxLength={2000}
          value={publicNote}
          onChange={(e) => setPublicNote(e.target.value)}
          aria-invalid={Boolean(errors.publicNote)}
        />
      </FormField>
      <FormField
        id="decision-internal-note"
        label="Internal note (optional, never shown to the requester)"
        error={errors.internalNote}
      >
        <Textarea
          id="decision-internal-note"
          className="min-h-12"
          maxLength={4000}
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
        />
      </FormField>
      <div>
        <Button
          type="submit"
          size="sm"
          variant={mode === 'reject' || isDeletion ? 'destructive' : 'default'}
          disabled={busy}
        >
          {busy
            ? 'Saving…'
            : mode === 'reject'
              ? 'Reject request'
              : isDeletion
                ? 'Anonymise account and complete'
                : 'Mark access request completed'}
        </Button>
      </div>
    </form>
  );
}
