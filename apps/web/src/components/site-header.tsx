'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

export function SiteHeader() {
  const { status, user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Vehicle Rental Platform
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {status === 'loading' ? (
            <span className="text-muted-foreground">…</span>
          ) : status === 'authenticated' && user ? (
            <>
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
