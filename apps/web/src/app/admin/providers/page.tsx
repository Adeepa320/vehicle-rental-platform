'use client';

import type {
  AdminProviderApplicationSummary,
  AdminProviderSummary,
  ProviderApplicationStatus,
  ProviderStatus,
} from '@vrp/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { ReasonAction } from '@/components/admin/reason-action';
import { AdminNav } from '@/components/admin/admin-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { submitErrorFrom } from '@/lib/forms';
import { APPLICATION_STATUS, PROVIDER_STATUS, formatDate } from '@/lib/provider-labels';

const selectClass =
  'border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

type Tab = 'applications' | 'providers';

export default function AdminProvidersPage() {
  const gate = useRequireAuth();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('applications');
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  if (gate !== 'ready') {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }
  if (!isAdmin) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <AdminNav />
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium">Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Provider review</h1>
        <p className="text-muted-foreground text-sm">
          Review is manual: confirm contact details and operating area with the applicant
          (phone/e-mail) before approving. No documents are collected in this phase.
        </p>
      </header>
      <div className="flex gap-2">
        <Button
          variant={tab === 'applications' ? 'default' : 'outline'}
          onClick={() => setTab('applications')}
        >
          Applications
        </Button>
        <Button
          variant={tab === 'providers' ? 'default' : 'outline'}
          onClick={() => setTab('providers')}
        >
          Approved providers
        </Button>
      </div>
      {tab === 'applications' ? <ApplicationsList /> : <ProvidersList />}
    </main>
  );
}

function ApplicationsList() {
  const { api, withAccessToken } = useAuth();
  const [status, setStatus] = useState<ProviderApplicationStatus | ''>('submitted');
  const [rows, setRows] = useState<AdminProviderApplicationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((token) =>
          api.admin.listApplications(token, { status: status || undefined, cursor, limit: 20 }),
        );
        setRows((current) => (cursor ? [...current, ...page.data] : page.data));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(submitErrorFrom(caught).message);
      } finally {
        setLoading(false);
      }
    },
    [api, status, withAccessToken],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="statusFilter">
          Status
        </label>
        <select
          id="statusFilter"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as ProviderApplicationStatus | '')}
        >
          <option value="">All</option>
          {(Object.keys(APPLICATION_STATUS) as ProviderApplicationStatus[]).map((s) => (
            <option key={s} value={s}>
              {APPLICATION_STATUS[s].label}
            </option>
          ))}
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Business</th>
              <th className="p-3 font-medium">Applicant</th>
              <th className="p-3 font-medium">District</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Submitted</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  {row.displayName ?? <span className="text-muted-foreground">(no name)</span>}
                </td>
                <td className="p-3">
                  {row.applicant.fullName}
                  <br />
                  <span className="text-muted-foreground text-xs">{row.applicant.email}</span>
                </td>
                <td className="p-3">{row.districtId ?? '—'}</td>
                <td className="p-3">
                  <Badge variant={APPLICATION_STATUS[row.status].tone}>
                    {APPLICATION_STATUS[row.status].label}
                  </Badge>
                </td>
                <td className="p-3">{formatDate(row.submittedAt)}</td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/admin/providers/applications/${row.id}`} />}
                  >
                    Review
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={6}>
                  No applications match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {nextCursor ? (
        <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </Button>
      ) : null}
    </section>
  );
}

function ProvidersList() {
  const { api, withAccessToken } = useAuth();
  const [status, setStatus] = useState<ProviderStatus | ''>('');
  const [rows, setRows] = useState<AdminProviderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((token) =>
          api.admin.listProviders(token, { status: status || undefined, cursor, limit: 20 }),
        );
        setRows((current) => (cursor ? [...current, ...page.data] : page.data));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(submitErrorFrom(caught).message);
      } finally {
        setLoading(false);
      }
    },
    [api, status, withAccessToken],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const replaceRow = (updated: {
    id: string;
    status: ProviderStatus;
    suspendedAt: string | null;
  }) =>
    setRows((current) =>
      current.map((r) =>
        r.id === updated.id
          ? { ...r, status: updated.status, suspendedAt: updated.suspendedAt }
          : r,
      ),
    );

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="providerStatusFilter">
          Status
        </label>
        <select
          id="providerStatusFilter"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as ProviderStatus | '')}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="grid gap-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{row.displayName}</p>
                <p className="text-muted-foreground text-xs">
                  {row.owner.fullName} · {row.owner.email} · {row.districtId} · approved{' '}
                  {formatDate(row.approvedAt)}
                </p>
              </div>
              <Badge variant={PROVIDER_STATUS[row.status].tone}>
                {PROVIDER_STATUS[row.status].label}
              </Badge>
            </div>
            <div className="mt-3">
              {row.status === 'active' ? (
                <ReasonAction
                  label="Suspend provider"
                  confirmLabel="Suspend"
                  variant="destructive"
                  placeholder="Reason shown to the provider (min 5 characters)"
                  onConfirm={async (reason) => {
                    const updated = await withAccessToken((token) =>
                      api.admin.suspendProvider(token, row.id, reason),
                    );
                    replaceRow(updated);
                  }}
                />
              ) : (
                <ReasonAction
                  label="Reactivate provider"
                  confirmLabel="Reactivate"
                  variant="default"
                  optional
                  placeholder="Internal note (optional)"
                  onConfirm={async (note) => {
                    const updated = await withAccessToken((token) =>
                      api.admin.reactivateProvider(token, row.id, note || undefined),
                    );
                    replaceRow(updated);
                  }}
                />
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && !loading ? (
          <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">
            No providers yet.
          </p>
        ) : null}
      </div>
      {nextCursor ? (
        <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </Button>
      ) : null}
    </section>
  );
}
