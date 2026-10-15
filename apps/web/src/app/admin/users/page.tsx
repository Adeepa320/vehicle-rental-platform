'use client';

import {
  UserRoleSchema,
  UserStatusSchema,
  type AdminUserSummary,
  type UserRole,
  type UserStatus,
} from '@vrp/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AdminShell, selectClass } from '@/components/admin/admin-shell';
import { FormMessage } from '@/components/auth/form-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { USER_STATUS } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function AdminUsersPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [rows, setRows] = useState<AdminUserSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = q.trim();
  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          api.admin.listUsers(t, {
            q: search.length >= 2 ? search : undefined,
            status: status || undefined,
            role: role || undefined,
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
    [api, role, search, status, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  return (
    <AdminShell area={area}>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          Every account (customers, providers, admins). Open an account to suspend, reactivate or
          anonymise it. Password hashes, tokens and sessions are never shown.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-64"
          placeholder="Search name or e-mail (2+ characters)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as UserStatus | '')}
        >
          <option value="">All statuses</option>
          {UserStatusSchema.options.map((s) => (
            <option key={s} value={s}>
              {USER_STATUS[s].label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole | '')}
        >
          <option value="">All roles</option>
          {UserRoleSchema.options.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Account</th>
              <th className="p-3 font-medium">Roles</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Provider</th>
              <th className="p-3 font-medium">Created</th>
              <th className="p-3 font-medium">Last login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  <Link
                    href={`/admin/users/${row.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {row.fullName}
                  </Link>
                  <br />
                  <span className="text-muted-foreground text-xs">
                    {row.email}
                    {row.emailVerified ? '' : ' (not verified)'}
                    {row.countryCode ? ` · ${row.countryCode}` : ''}
                  </span>
                </td>
                <td className="p-3">{row.roles.join(', ')}</td>
                <td className="p-3">
                  <Badge variant={USER_STATUS[row.status].tone}>
                    {USER_STATUS[row.status].label}
                  </Badge>
                </td>
                <td className="p-3">
                  {row.providerId ? (
                    <Link
                      href={`/admin/providers/${row.providerId}`}
                      className="underline underline-offset-4"
                    >
                      Provider profile
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-3">{formatDateTime(row.createdAt)}</td>
                <td className="p-3">{formatDateTime(row.lastLoginAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={6}>
                  No accounts match this filter.
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
    </AdminShell>
  );
}
