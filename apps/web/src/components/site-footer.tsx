import Link from 'next/link';

import { BrandMark } from '@/components/brand-mark';
import { legalLinks } from '@/lib/legal-pages';

/** Site-wide footer with the legal documents; rendered on the server on every page. */
export function SiteFooter() {
  const links = legalLinks();
  return (
    <footer className="bg-card mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <BrandMark className="size-6 shrink-0" />
          <span>
            <span className="text-brand font-semibold">Vehicle Rental Platform</span> · Sri Lanka’s
            South Coast
          </span>
        </p>
        {links.length > 0 ? (
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="hover:text-foreground underline underline-offset-4"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
