'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/provider/dashboard', label: 'Dashboard' },
  { href: '/provider/locations', label: 'Locations' },
  { href: '/provider/vehicles', label: 'Vehicles' },
  { href: '/provider/bookings', label: 'Bookings' },
];

/** Sub-navigation for the provider area. */
export function ProviderNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Button
            key={link.href}
            size="sm"
            variant={active ? 'default' : 'outline'}
            nativeButton={false}
            render={<Link href={link.href} />}
          >
            {link.label}
          </Button>
        );
      })}
    </nav>
  );
}
