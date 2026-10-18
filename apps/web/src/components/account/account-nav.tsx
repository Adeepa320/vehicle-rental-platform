'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

/** Sub-navigation for the account area. Security (password; MFA for privileged roles) is for everyone. */
export function AccountNav() {
  const pathname = usePathname();
  const links = [
    { href: '/account', label: 'Profile' },
    { href: '/account/security', label: 'Security' },
    { href: '/account/privacy', label: 'Privacy and data' },
  ];
  return (
    <nav aria-label="Account sections" className="flex flex-wrap gap-2">
      {links.map((link) => {
        const active =
          link.href === '/account'
            ? pathname === '/account'
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Button
            key={link.href}
            size="sm"
            variant={active ? 'default' : 'outline'}
            nativeButton={false}
            render={<Link href={link.href} aria-current={active ? 'page' : undefined} />}
          >
            {link.label}
          </Button>
        );
      })}
    </nav>
  );
}
