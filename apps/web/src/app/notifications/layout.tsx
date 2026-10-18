import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = { ...noIndexMetadata, title: 'Notifications' };

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return children;
}
