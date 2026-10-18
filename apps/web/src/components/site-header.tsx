'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { NotificationBell } from '@/components/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { isPrivilegedRole } from '@/lib/auth/mfa';

export function SiteHeader() {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const isProvider = user?.roles.includes('provider') ?? false;
  const isAdmin = isPrivilegedRole(user?.roles);

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold tracking-tight">
            Vehicle Rental Platform
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 text-sm sm:flex">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/search" />}>
              Search
            </Button>
            {isProvider ? (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/provider/dashboard" />}
              >
                Provider
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/become-a-provider" />}
              >
                Become a provider
              </Button>
            )}
            {isAdmin ? (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/admin" />}
              >
                Admin
              </Button>
            ) : null}
          </nav>
        </div>
        <nav aria-label="Account" className="flex items-center gap-2 text-sm">
          {status === 'loading' ? (
            <span
              className="text-muted-foreground"
              role="status"
              aria-label="Checking your session"
            >
              …
            </span>
          ) : status === 'authenticated' && user ? (
            <>
              <NotificationBell />
              <Button variant="ghost" nativeButton={false} render={<Link href="/bookings" />}>
                My bookings
              </Button>
              {isAdmin ? (
                <Button
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href="/account/security" />}
                >
                  Security
                </Button>
              ) : null}
              <Button
                variant="ghost"
                nativeButton={false}
                render={<Link href="/account" aria-label={`${user.fullName} (your account)`} />}
              >
                {user.fullName}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await logout();
                  router.push('/');
                }}
              >
                Log out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>
                Log in
              </Button>
              <Button nativeButton={false} render={<Link href="/register" />}>
                Create account
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
