'use client';

import type { AuditEventView } from '@vrp/contracts';
import { useCallback, useEffect, useState } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AUDIT_ACTOR_LABEL, compactJson } from '@/lib/admin-labels';
import { useAdminArea } from '@/lib/auth/use-admin-area';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

/** `YYYY-MM-DD` → start / end of that Colombo day as an offset ISO instant. */
const dayStart = (day: string) => (day ? `${day}T00:00:00+05:30` : undefined);
const dayEnd = (day: string) => (day ? `${day}T23:59:59+05:30` : undefined);

export default function AdminAuditPage() {
  const area = useAdminArea();
  const { api, ready, withAccessToken } = area;
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({
    action: '',
    targetType: '',
    targetId: '',
    actorUserId: '',
    from: '',
    to: '',
  });
  const [rows, setRows] = useState<AuditEventView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          api.admin.listAuditEvents(t, {
            action: applied.action.trim() || undefined,
            targetType: applied.targetType.trim() || undefined,
            targetId: applied.targetId.trim() || undefined,
            actorUserId: applied.actorUserId.trim() || undefined,
            from: dayStart(applied.from),
            to: dayEnd(applied.to),
            cursor,
            limit: 50,
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
    [api, applied, withAccessToken],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, ready]);

  return (
    <AdminShell area={area} width="max-w-6xl">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Append-only record of every admin decision and sensitive action, newest first. Metadata
          holds ids, codes and amounts only; secrets are never stored.
        </p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ action, targetType, targetId, actorUserId, from, to });
        }}
      >
        <label className="text-muted-foreground grid gap-1 text-xs">
          Action (exact or prefix like <code>vehicle.</code>)
          <Input className="w-48" value={action} onChange={(e) => setAction(e.target.value)} />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          Target type
          <Input
            className="w-36"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
          />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          Target id
          <Input className="w-72" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          Actor user id
          <Input
            className="w-72"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
          />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          From
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          To
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button type="submit" variant="outline" disabled={loading}>
          Apply filters
        </Button>
      </form>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">When</th>
              <th className="p-3 font-medium">Actor</th>
              <th className="p-3 font-medium">Action</th>
              <th className="p-3 font-medium">Target</th>
              <th className="p-3 font-medium">Reason</th>
              <th className="p-3 font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr key={event.id} className="border-t align-top">
                <td className="p-3 whitespace-nowrap">{formatDateTime(event.createdAt)}</td>
                <td className="p-3">
                  {event.actor ? (
                    <>
                      {event.actor.fullName}
                      <br />
                      <span className="text-muted-foreground text-xs">{event.actor.email}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {AUDIT_ACTOR_LABEL[event.actorType]}
                    </span>
                  )}
                </td>
                <td className="p-3 font-mono text-xs">{event.action}</td>
                <td className="p-3 font-mono text-xs">
                  {event.targetType}
                  {event.targetId ? (
                    <>
                      <br />
                      <span className="text-muted-foreground">{event.targetId}</span>
                    </>
                  ) : null}
                </td>
                <td className="p-3 max-w-xs whitespace-pre-wrap">{event.reason ?? '—'}</td>
                <td className="p-3 max-w-sm font-mono text-xs break-all">
                  {compactJson(event.metadata)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading ? (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={6}>
                  No audit events match this filter.
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
