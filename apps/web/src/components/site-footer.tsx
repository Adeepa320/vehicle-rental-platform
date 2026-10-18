import Link from 'next/link';

import { legalLinks } from '@/lib/legal-pages';

/** Site-wide footer with the legal documents; rendered on the server on every page. */
export function SiteFooter() {
  const links = legalLinks();
  return (
    <footer className="mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>Vehicle Rental Platform · Sri Lanka</p>
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
