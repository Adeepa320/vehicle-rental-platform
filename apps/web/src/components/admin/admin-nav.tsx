'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/providers', label: 'Providers' },
  { href: '/admin/vehicles', label: 'Vehicles' },
  { href: '/admin/bookings', label: 'Bookings' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/reviews', label: 'Reviews' },
  { href: '/admin/disputes', label: 'Disputes' },
  { href: '/admin/documents', label: 'Documents' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/reference', label: 'Reference' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/audit', label: 'Audit log' },
];

/** Sub-navigation for the admin area. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const active =
          link.href === '/admin'
            ? pathname === '/admin'
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
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
