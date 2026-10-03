'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

export function BecomeProviderCta() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <span className="text-muted-foreground text-sm">…</span>;
  }
  if (status === 'authenticated' && user?.roles.includes('provider')) {
    return (
      <Button nativeButton={false} render={<Link href="/provider/dashboard" />}>
        Open your provider dashboard
      </Button>
    );
  }
  if (status === 'authenticated') {
    return (
      <Button nativeButton={false} render={<Link href="/provider/application" />}>
        Start or continue your application
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button nativeButton={false} render={<Link href="/register" />}>
        Create an account to apply
      </Button>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href="/login?next=/provider/application" />}
      >
        Log in
      </Button>
    </div>
  );
}
