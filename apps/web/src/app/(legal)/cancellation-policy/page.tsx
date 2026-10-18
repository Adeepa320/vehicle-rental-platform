import type { Metadata } from 'next';

import { LegalDocumentPage } from '@/components/legal/legal-document';
import { legalPageMetadata } from '@/lib/legal-pages';

export const metadata: Metadata = legalPageMetadata('cancellation-policy');

export default function CancellationPolicyPage() {
  return <LegalDocumentPage id="cancellation-policy" />;
}
