'use client';

import {
  AdminCreatePrivacyRequestSchema,
  PrivacyRequestStatusSchema,
  PrivacyRequestTypeSchema,
  type AdminPrivacyRequest,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from '@vrp/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { USER_STATUS } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';
import { PRIVACY_REQUEST_STATUS, PRIVACY_REQUEST_TYPE_LABEL } from '@/lib/privacy-labels';

export default function AdminPrivacyRequestsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-5xl px-4 py-12">
          <p className="text-muted-foreground text-sm" role="status">
            Loading…
          </p>
        </main>
      }
    >
      <PrivacyRequestsList />
    </Suspense>
  );
}

function PrivacyRequestsList() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const searchParams = useSearchParams();
  const initialStatus = PrivacyRequestStatusSchema.safeParse(searchParams.get('status'));
  const initialType = PrivacyRequestTypeSchema.safeParse(searchParams.get('type'));
  const [status, setStatus] = useState<PrivacyRequestStatus | ''>(
    initialStatus.success ? initialStatus.data : 'open',
  );
  const [type, setType] = useState<PrivacyRequestType | ''>(
    initialType.success ? initialType.data : '',
  );
  const [rows, setRows] = useState<AdminPrivacyRequest[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          api.admin.listPrivacyRequests(t, {
            status: status || undefined,
            type: type || undefined,
            cursor,
            limit: 30,
          }),
        );
        setRows((current) => (cursor ? [...current, ...page.data] : page.data));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(submitErrorFrom(caught).message);
      } finally {
        setLoading(false);
      }
    },
    [api, status, type, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  return (
    <AdminShell area={area}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy requests</h1>
        <p className="text-muted-foreground text-sm">
          Requests from account holders for a copy of their data or for deletion. Deletion is
          completed through the same anonymisation as under Users; access requests are completed
          once the export has been handed over. Every decision is audited.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="pr-status">
          Status
        </label>
        <select
          id="pr-status"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as PrivacyRequestStatus | '')}
        >
          <option value="">All statuses</option>
          {PrivacyRequestStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {PRIVACY_REQUEST_STATUS[s].label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="pr-type">
          Type
        </label>
        <select
          id="pr-type"
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as PrivacyRequestType | '')}
        >
          <option value="">All types</option>
          {PrivacyRequestTypeSchema.options.map((t) => (
            <option key={t} value={t}>
              {PRIVACY_REQUEST_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">Privacy requests</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="p-3 font-medium">
                Requested
              </th>
              <th scope="col" className="p-3 font-medium">
                Type
              </th>
              <th scope="col" className="p-3 font-medium">
                Account
              </th>
              <th scope="col" className="p-3 font-medium">
                Status
              </th>
              <th scope="col" className="p-3 font-medium">
                Source
              </th>
              <th scope="col" className="p-3 font-medium">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  <Link
                    href={`/admin/privacy-requests/${row.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {formatDateTime(row.requestedAt)}
                  </Link>
                </td>
                <td className="p-3">{PRIVACY_REQUEST_TYPE_LABEL[row.type]}</td>
                <td className="p-3">
                  {row.user.fullName}
                  <br />
                  <span className="text-muted-foreground text-xs">
                    {row.user.email} · {USER_STATUS[row.user.status].label}
                  </span>
                </td>
                <td className="p-3">
                  <Badge variant={PRIVACY_REQUEST_STATUS[row.status].tone}>
                    {PRIVACY_REQUEST_STATUS[row.status].label}
                  </Badge>
                  {row.type === 'deletion' && row.blockers.length > 0 ? (
                    <span className="text-muted-foreground block text-xs">
                      {row.blockers.length} blocker{row.blockers.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">
                  {row.source === 'self' ? 'Account holder' : 'Recorded by admin'}
                </td>
                <td className="p-3">{formatDateTime(row.updatedAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={6}>
                  No requests match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading…
        </p>
      ) : null}
      {nextCursor ? (
        <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </Button>
      ) : null}
      <RecordRequestCard />
    </AdminShell>
  );
}

/** A request that arrived by e-mail or phone, recorded on the account holder's behalf. */
function RecordRequestCard() {
  const { api, withAccessToken } = useAdminArea();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [type, setType] = useState<PrivacyRequestType>('access');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = AdminCreatePrivacyRequestSchema.safeParse({
      userId: userId.trim(),
      type,
      requesterNote: note.trim() === '' ? undefined : note.trim(),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const created = await withAccessToken((t) => api.admin.createPrivacyRequest(t, parsed.data));
      router.push(`/admin/privacy-requests/${created.id}`);
    } catch (caught) {
      const failure = submitErrorFrom(caught);
      setErrors(failure.fields);
      setMessage(
        failure.code === 'PRIVACY_REQUEST_ALREADY_OPEN'
          ? 'This account already has an open request of that type.'
          : failure.message,
      );
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-md border p-4" aria-labelledby="record-request-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="record-request-heading" className="text-sm font-medium">
          Record a request received outside the platform
        </h2>
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Record a request
          </Button>
        ) : null}
      </div>
      {open ? (
        <form className="grid gap-3" onSubmit={(e) => void submit(e)} noValidate>
          {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <FormField
              id="record-user-id"
              label="User id"
              error={errors.userId}
              hint="Copy it from the account page under Users."
            >
              <Input
                id="record-user-id"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                aria-invalid={Boolean(errors.userId)}
              />
            </FormField>
            <FormField id="record-type" label="Type" error={errors.type}>
              <select
                id="record-type"
                className={`${selectClass} w-full`}
                value={type}
                onChange={(e) => setType(e.target.value as PrivacyRequestType)}
              >
                {PrivacyRequestTypeSchema.options.map((t) => (
                  <option key={t} value={t}>
                    {PRIVACY_REQUEST_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField
            id="record-note"
            label="What the person asked for (optional, kept with the request)"
            error={errors.requesterNote}
          >
            <Textarea
              id="record-note"
              className="min-h-16"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Recording…' : 'Record request'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
