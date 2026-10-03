'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/admin/providers', label: 'Providers' },
  { href: '/admin/vehicles', label: 'Vehicles' },
];

/** Sub-navigation for the admin area. */
export function AdminNav() {
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
