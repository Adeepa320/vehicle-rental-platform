'use client';

import type { ReactNode } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { FormMessage } from '@/components/auth/form-primitives';
import type { AdminAreaState } from '@/lib/auth/use-admin-area';

interface AdminShellProps {
  area: AdminAreaState;
  /** Tailwind max-width class; defaults to the list width. */
  width?: 'max-w-3xl' | 'max-w-4xl' | 'max-w-5xl' | 'max-w-6xl';
  children: ReactNode;
}

/** Page frame for the admin console: session gate, "not authorised", sub-navigation. */
export function AdminShell({ area, width = 'max-w-5xl', children }: AdminShellProps) {
  if (area.gate !== 'ready') {
    return (
      <main className={`mx-auto w-full ${width} px-4 py-12`}>
        <p className="text-muted-foreground text-sm">Loading…</p>
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
