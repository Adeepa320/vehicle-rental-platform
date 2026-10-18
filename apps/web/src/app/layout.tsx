import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import './globals.css';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { AuthProvider } from '@/lib/auth/auth-context';
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from '@/lib/seo';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_LK' },
  twitter: { card: 'summary' },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every route renders per request: the CSP nonce generated in `src/proxy.ts` is
  // read by Next from the request's Content-Security-Policy header and stamped on
  // its inline runtime scripts, which a build-time render could never carry.
  await connection();
  return (
    <html lang="en" suppressHydrationWarning className={cn('font-sans', geist.variable)}>
      <body className="bg-background text-foreground flex min-h-screen flex-col font-sans antialiased">
        <a
          href="#main-content"
          className="bg-background text-foreground focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:outline-none"
        >
          Skip to content
        </a>
        <AuthProvider>
          <SiteHeader />
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
            {children}
          </div>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
