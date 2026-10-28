'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { NotificationBell } from '@/components/notifications/notification-bell';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { isPrivilegedRole } from '@/lib/auth/mfa';

const navLinkClass = 'text-foreground/80 hover:text-brand text-sm';

export function SiteHeader() {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const isProvider = user?.roles.includes('provider') ?? false;
  const isAdmin = isPrivilegedRole(user?.roles);

  return (
    <header className="bg-card border-b shadow-xs">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-brand flex items-center gap-2.5 rounded-md font-bold tracking-tight"
          >
            <BrandMark className="size-8 shrink-0" />
            <span className="flex flex-col leading-tight">
              <span>Vehicle Rental Platform</span>
              <span className="text-muted-foreground hidden text-[0.7rem] font-medium tracking-wide uppercase sm:block">
                South Coast · Sri Lanka
              </span>
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            <Button
              variant="ghost"
              className={navLinkClass}
              nativeButton={false}
              render={<Link href="/search" />}
            >
              Search
            </Button>
            {isProvider ? (
              <Button
                variant="ghost"
                className={navLinkClass}
                nativeButton={false}
                render={<Link href="/provider/dashboard" />}
              >
                Provider
              </Button>
            ) : (
              <Button
                variant="ghost"
                className={navLinkClass}
                nativeButton={false}
                render={<Link href="/become-a-provider" />}
              >
                Become a provider
              </Button>
            )}
            {isAdmin ? (
              <Button
                variant="ghost"
                className={navLinkClass}
                nativeButton={false}
                render={<Link href="/admin" />}
              >
                Admin
              </Button>
            ) : null}
          </nav>
        </div>
        <nav aria-label="Account" className="flex flex-wrap items-center gap-1.5 text-sm">
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
              <Button
                variant="ghost"
                className={navLinkClass}
                nativeButton={false}
                render={<Link href="/bookings" />}
              >
                My bookings
              </Button>
              {isAdmin ? (
                <Button
                  variant="ghost"
                  className={navLinkClass}
                  nativeButton={false}
                  render={<Link href="/account/security" />}
                >
                  Security
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className={`${navLinkClass} max-w-48 truncate`}
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
              <Button
                variant="ghost"
                className={navLinkClass}
                nativeButton={false}
                render={<Link href="/login" />}
              >
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
