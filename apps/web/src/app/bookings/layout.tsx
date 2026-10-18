import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = { ...noIndexMetadata, title: 'Bookings' };

export default function BookingsLayout({ children }: { children: ReactNode }) {
  return children;
}
