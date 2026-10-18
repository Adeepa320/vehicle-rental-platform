import type { ReactNode } from 'react';

/** Route group for the legal texts; exists so the group can carry its own not-found page. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return children;
}
