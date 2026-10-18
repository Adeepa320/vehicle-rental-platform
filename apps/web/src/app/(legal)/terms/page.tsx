import type { Metadata } from 'next';

import { LegalDocumentPage } from '@/components/legal/legal-document';
import { legalPageMetadata } from '@/lib/legal-pages';

export const metadata: Metadata = legalPageMetadata('terms');

export default function TermsPage() {
  return <LegalDocumentPage id="terms" />;
}
