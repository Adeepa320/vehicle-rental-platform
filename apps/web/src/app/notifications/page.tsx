'use client';

import type { Notification } from '@vrp/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { formatDateTime } from '@/lib/booking-labels';
import { submitErrorFrom } from '@/lib/forms';

export default function NotificationsPage() {
  const gate = useRequireAuth();
  const { api, withAccessToken } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [loadedFilter, setLoadedFilter] = useState<boolean | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (gate !== 'ready') return;
    let cancelled = false;
    withAccessToken((t) =>
      api.notifications.list(t, { limit: 20, unreadOnly: unreadOnly || undefined }),
    )
      .then((page) => {
        if (cancelled) return;
        setItems(page.data);
        setLoadedFilter(unreadOnly);
        setCursor(page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(submitErrorFrom(caught).message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, gate, unreadOnly, withAccessToken]);

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await withAccessToken((t) =>
        api.notifications.list(t, { limit: 20, cursor, unreadOnly: unreadOnly || undefined }),
      );
      setItems((current) => [...(current ?? []), ...page.data]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(item: Notification) {
    try {
      if (!item.readAt) {
        const updated = await withAccessToken((t) => api.notifications.markRead(t, item.id));
        setItems((current) => current?.map((n) => (n.id === item.id ? updated : n)) ?? null);
      }
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    }
    if (item.linkPath) router.push(item.linkPath);
  }

  async function readAll() {
    setBusy(true);
    try {
      await withAccessToken((t) => api.notifications.markAllRead(t));
      const now = new Date().toISOString();
      setItems((current) => current?.map((n) => ({ ...n, readAt: n.readAt ?? now })) ?? null);
    } catch (caught) {
      setError(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={unreadOnly ? 'default' : 'outline'}
            onClick={() => setUnreadOnly((v) => !v)}
          >
            {unreadOnly ? 'Showing unread' : 'Unread only'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void readAll()}>
            Mark all read
          </Button>
        </div>
      </header>
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
      {gate !== 'ready' || items === null || loadedFilter !== unreadOnly ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {unreadOnly
            ? 'Nothing unread.'
            : 'No notifications yet. Booking updates and reminders appear here.'}
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void open(item)}
                className={`w-full rounded-md border p-3 text-left text-sm ${item.readAt ? 'bg-background' : 'bg-muted/40 border-primary/40'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className={item.readAt ? 'font-normal' : 'font-semibold'}>{item.title}</p>
                  <time
                    className="text-muted-foreground shrink-0 text-xs"
                    dateTime={item.createdAt}
                  >
                    {formatDateTime(item.createdAt)}
                  </time>
                </div>
                <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{item.body}</p>
                {item.linkPath ? (
                  <p className="text-muted-foreground mt-1 text-xs underline underline-offset-4">
                    Open
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadMore()}>
          {busy ? 'Loading…' : 'Load older notifications'}
        </Button>
      ) : null}
    </main>
  );
}
