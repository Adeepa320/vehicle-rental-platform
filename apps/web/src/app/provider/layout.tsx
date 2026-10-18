import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = { ...noIndexMetadata, title: 'Provider area' };

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return children;
}
