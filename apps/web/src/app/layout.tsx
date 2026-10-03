import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { AuthProvider } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: {
    default: 'Vehicle Rental Platform',
    template: '%s · Vehicle Rental Platform',
  },
  description:
    'Search nearby vehicles, see real availability, compare transparent prices and book from verified providers in Sri Lanka.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn('font-sans', geist.variable)}>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <AuthProvider>
          <SiteHeader />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
