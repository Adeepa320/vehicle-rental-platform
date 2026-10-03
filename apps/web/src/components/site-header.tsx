'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

export function SiteHeader() {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const isProvider = user?.roles.includes('provider') ?? false;
  const isAdmin = (user?.roles.includes('admin') || user?.roles.includes('super_admin')) ?? false;

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold tracking-tight">
            Vehicle Rental Platform
          </Link>
          <nav className="hidden items-center gap-1 text-sm sm:flex">
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
                render={<Link href="/admin/providers" />}
              >
                Admin
              </Button>
            ) : null}
          </nav>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          {status === 'loading' ? (
            <span className="text-muted-foreground">…</span>
          ) : status === 'authenticated' && user ? (
            <>
              <Button variant="ghost" nativeButton={false} render={<Link href="/bookings" />}>
                My bookings
              </Button>
              <Button variant="ghost" nativeButton={false} render={<Link href="/account" />}>
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
