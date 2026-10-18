'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import type { AdminAreaState } from '@/lib/auth/use-admin-area';

interface AdminShellProps {
  area: AdminAreaState;
  /** Tailwind max-width class; defaults to the list width. */
  width?: 'max-w-3xl' | 'max-w-4xl' | 'max-w-5xl' | 'max-w-6xl';
  children: ReactNode;
}

/**
 * Page frame for the admin console: session gate, "not authorised",
 * sub-navigation, and the two-step-verification gate. A `403 MFA_REQUIRED`
 * from any privileged call either sends the admin to set up an authenticator
 * (`enrolment_required`) or explains that this session must be re-established
 * (`challenge_required`).
 */
export function AdminShell({ area, width = 'max-w-5xl', children }: AdminShellProps) {
  const { mfaRequirement, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const needsEnrolment =
    area.gate === 'ready' && area.isAdmin && mfaRequirement?.issue === 'enrolment_required';

  useEffect(() => {
    if (needsEnrolment) router.replace('/account/security?reason=mfa');
  }, [needsEnrolment, router]);

  if (area.gate !== 'ready') {
    return (
      <main className={`mx-auto w-full ${width} px-4 py-12`}>
        <p className="text-muted-foreground text-sm" role="status">
          Loading…
        </p>
      </main>
    );
  }
  if (!area.isAdmin) {
    return (
      <main className={`mx-auto w-full ${width} px-4 py-12`}>
        <FormMessage variant="destructive" title="Not authorised">
          This area is for platform administrators.
        </FormMessage>
      </main>
    );
  }
  if (needsEnrolment) {
    return (
      <main className={`mx-auto w-full ${width} px-4 py-12`}>
        <FormMessage title="Two-step verification required">
          Taking you to your security settings to set up an authenticator app…
        </FormMessage>
      </main>
    );
  }
  if (mfaRequirement?.issue === 'challenge_required') {
    return (
      <main className={`mx-auto flex w-full ${width} flex-col gap-6 px-4 py-12`}>
        <AdminNav />
        <FormMessage title="Sign in again to use the console">
          <p>
            Your account uses two-step verification, but this session was opened before it was set
            up (or without the second step), so privileged actions are refused. Log in again and
            enter a code from your authenticator app.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                await logout();
                router.push(`/login?next=${encodeURIComponent(pathname)}`);
              }}
            >
              Sign in again
            </Button>
          </div>
        </FormMessage>
      </main>
    );
  }
  return (
    <main className={`mx-auto flex w-full ${width} flex-col gap-6 px-4 py-12`}>
      <AdminNav />
      {children}
    </main>
  );
}

/** Label + value rows used across the console detail pages. */
export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-[200px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const selectClass =
  'border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';
