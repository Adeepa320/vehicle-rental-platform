'use client';

import type { AdminUserDetail } from '@vrp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminShell, DetailRows } from '@/components/admin/admin-shell';
import { ReasonAction } from '@/components/admin/reason-action';
import { AuthCard, FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ANONYMISATION_BLOCKER_LABEL, USER_STATUS } from '@/lib/admin-labels';
import { ApiClientError } from '@/lib/api-client';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function AdminUserDetailPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !params.id) return;
    let cancelled = false;
    withAccessToken((t) => api.admin.getUser(t, params.id))
      .then((result) => {
        if (!cancelled) setUser(result);
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
        href="/admin/users"
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← All users
      </Link>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {!user ? (
        <p className="text-muted-foreground text-sm">Loading account…</p>
      ) : (
        <UserDetail user={user} onChanged={setUser} />
      )}
    </AdminShell>
  );
}

function UserDetail({
  user,
  onChanged,
}: {
  user: AdminUserDetail;
  onChanged: (user: AdminUserDetail) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const status = USER_STATUS[user.status];
  const isDeleted = user.status === 'deleted';

  return (
    <>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{user.fullName}</h1>
          <Badge variant={status.tone}>{status.label}</Badge>
          {user.roles.map((role) => (
            <Badge key={role} variant="outline">
              {role}
            </Badge>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          {user.email}
          {user.emailVerified ? ' · e-mail verified' : ' · e-mail NOT verified'} · member since{' '}
          {formatDateTime(user.createdAt)}
        </p>
      </header>

      {user.suspensionReason ? (
        <FormMessage variant="destructive" title="Suspension reason">
          <p className="whitespace-pre-wrap">{user.suspensionReason}</p>
          <p className="text-xs">Suspended {formatDateTime(user.suspendedAt)}.</p>
        </FormMessage>
      ) : null}
      {isDeleted ? (
        <FormMessage title="Anonymised account">
          This account was anonymised on {formatDateTime(user.deletedAt)}. Personal data was
          replaced with neutral values; bookings and payments are kept for the retention period.
        </FormMessage>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <AuthCard title="Account" description="Profile fields only; no credentials or sessions.">
          <DetailRows
            rows={[
              [
                'Phone',
                user.phone ? `${user.phone}${user.phoneVerified ? '' : ' (not verified)'}` : '—',
              ],
              ['Country', user.countryCode ?? '—'],
              ['Language', user.preferredLanguage],
              ['Last login', formatDateTime(user.lastLoginAt)],
              [
                'Provider profile',
                user.provider ? (
                  <Link
                    href={`/admin/providers/${user.provider.id}`}
                    className="underline underline-offset-4"
                  >
                    {user.provider.displayName} ({user.provider.status})
                  </Link>
                ) : (
                  'None'
                ),
              ],
            ]}
          />
        </AuthCard>
        <AuthCard title="Activity" description="Counts only; open the queues for details.">
          <DetailRows
            rows={[
              [
                'Bookings as customer',
                `${user.bookings.asCustomer.total} total · ${user.bookings.asCustomer.open} open · ${user.bookings.asCustomer.completed} completed`,
              ],
              [
                'Bookings as provider',
                `${user.bookings.asProvider.total} total · ${user.bookings.asProvider.open} open · ${user.bookings.asProvider.completed} completed`,
              ],
              ['Reviews written', String(user.reviews)],
              ['Open disputes', String(user.openDisputes)],
              [
                'Bookings',
                <Link
                  key="bookings"
                  href={`/admin/bookings?customerId=${user.id}`}
                  className="underline underline-offset-4"
                >
                  Open this customer’s bookings
                </Link>,
              ],
            ]}
          />
        </AuthCard>
      </div>

      {!isDeleted ? (
        <AuthCard
          title="Account standing"
          description="Suspending blocks sign-in and every write. The reason is kept in the audit log and shown to the user."
        >
          <div className="flex flex-wrap gap-3">
            {user.status === 'active' ? (
              <ReasonAction
                label="Suspend account"
                confirmLabel="Suspend"
                variant="destructive"
                placeholder="Reason (required, 5–500 characters)"
                onConfirm={async (reason) =>
                  onChanged(
                    await withAccessToken((t) => api.admin.suspendUser(t, user.id, { reason })),
                  )
                }
              />
            ) : (
              <ReasonAction
                label="Reactivate account"
                confirmLabel="Reactivate"
                optional
                placeholder="Internal note (optional)"
                onConfirm={async (note) =>
                  onChanged(
                    await withAccessToken((t) =>
                      api.admin.reactivateUser(t, user.id, note ? { note } : {}),
                    ),
                  )
                }
              />
            )}
          </div>
        </AuthCard>
      ) : null}

      {!isDeleted ? <AnonymiseCard user={user} onChanged={onChanged} /> : null}
    </>
  );
}

function AnonymiseCard({
  user,
  onChanged,
}: {
  user: AdminUserDetail;
  onChanged: (user: AdminUserDetail) => void;
}) {
  const { api, withAccessToken } = useAdminArea();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);

  const emailMatches = confirmEmail.trim().toLowerCase() === user.email.toLowerCase();
  const canSubmit =
    user.anonymisation.allowed && emailMatches && reason.trim().length >= 5 && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setMessage(null);
    setServerBlockers([]);
    try {
      onChanged(
        await withAccessToken((t) =>
          api.admin.anonymiseUser(t, user.id, {
            reason: reason.trim(),
            confirmEmail: confirmEmail.trim(),
          }),
        ),
      );
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'ACCOUNT_ANONYMISATION_BLOCKED') {
        setServerBlockers((caught.details ?? []).map((d) => blockerLabel(d.issue)));
      }
      setMessage(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Anonymise account"
      description="Irreversible. Replaces the name, e-mail and phone with neutral values, removes the login and keeps bookings, payments and audit rows under the retention policy (SECURITY_AND_PRIVACY §6)."
    >
      <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <FormMessage variant="destructive" title="This cannot be undone">
          The user will not be able to sign in again and no personal data can be restored. Use it
          only for a verified deletion request or a confirmed abuse case.
        </FormMessage>
        {!user.anonymisation.allowed ? (
          <FormMessage title="Blocked right now">
            <ul className="list-disc pl-5">
              {user.anonymisation.blockers.map((b) => (
                <li key={b}>{ANONYMISATION_BLOCKER_LABEL[b]}</li>
              ))}
            </ul>
            <p className="text-xs">Resolve these first; the API refuses the request until then.</p>
          </FormMessage>
        ) : null}
        {serverBlockers.length > 0 ? (
          <FormMessage variant="destructive" title="Refused by the server">
            <ul className="list-disc pl-5">
              {serverBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </FormMessage>
        ) : message ? (
          <FormMessage variant="destructive">{message}</FormMessage>
        ) : null}
        <FormField
          id="confirm-email"
          label="Type the account’s e-mail address to confirm"
          hint={emailMatches ? 'Matches.' : `Must match ${user.email} exactly.`}
        >
          <Input
            id="confirm-email"
            autoComplete="off"
            disabled={!user.anonymisation.allowed}
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
          />
        </FormField>
        <FormField id="anonymise-reason" label="Reason (audit log, 5–500 characters)">
          <Textarea
            id="anonymise-reason"
            className="min-h-16"
            disabled={!user.anonymisation.allowed}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <div>
          <Button type="submit" variant="destructive" disabled={!canSubmit}>
            {busy ? 'Anonymising…' : 'Anonymise this account permanently'}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

function blockerLabel(issue: string): string {
  return issue in ANONYMISATION_BLOCKER_LABEL
    ? ANONYMISATION_BLOCKER_LABEL[issue as keyof typeof ANONYMISATION_BLOCKER_LABEL]
    : issue;
}
