'use client';

import type { UserRole } from '@vrp/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from './auth-context';

export type RequireAuthState = 'loading' | 'forbidden' | 'ready';

/**
 * Client-side gate for pages that need a session (and optionally a role).
 * Anonymous visitors are sent to the login page with a return path. The API
 * enforces the real authorization; this only shapes the UI.
 */
export function useRequireAuth(role?: UserRole): RequireAuthState {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, router, status]);

  if (status !== 'authenticated' || !user) return 'loading';
  if (role && !user.roles.includes(role)) return 'forbidden';
  return 'ready';
}
