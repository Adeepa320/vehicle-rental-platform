import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = { ...noIndexMetadata, title: 'Your account' };

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
