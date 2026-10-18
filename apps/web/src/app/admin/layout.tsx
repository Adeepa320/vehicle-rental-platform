import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = { ...noIndexMetadata, title: 'Admin console' };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
