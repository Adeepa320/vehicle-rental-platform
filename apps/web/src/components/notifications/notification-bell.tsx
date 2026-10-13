'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

const POLL_MS = 60_000;

/**
 * Unread indicator in the header. Polls the indexed unread-count endpoint
 * once a minute and on navigation; no websockets in this release.
 */
export function NotificationBell() {
  const { status, api, withAccessToken } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    const load = () =>
      withAccessToken((t) => api.notifications.unreadCount(t))
        .then((r) => {
          if (!cancelled) setUnread(r.unread);
        })
        .catch(() => {
          // A failed poll keeps the last value; the page itself reports errors.
        });
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, pathname, status, withAccessToken]);

  const label =
    unread && unread > 0 ? `Notifications (${unread > 99 ? '99+' : unread})` : 'Notifications';
  return (
    <Button
      variant="ghost"
      nativeButton={false}
      render={<Link href="/notifications" aria-label={label} />}
      className={unread && unread > 0 ? 'font-semibold' : undefined}
    >
      <span aria-hidden>🔔</span>
      <span className="hidden sm:inline"> {label}</span>
      {unread && unread > 0 ? (
        <span className="bg-primary text-primary-foreground ml-1 rounded-full px-1.5 text-xs sm:hidden">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Button>
  );
}
