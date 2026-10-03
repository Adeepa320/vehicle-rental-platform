import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">{children}</main>;
}
