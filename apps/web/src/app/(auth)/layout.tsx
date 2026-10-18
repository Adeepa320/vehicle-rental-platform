import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = { ...noIndexMetadata, title: 'Account access' };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">{children}</main>;
}
