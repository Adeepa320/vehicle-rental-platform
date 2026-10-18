import type { Metadata } from 'next';

import { LegalDocumentPage } from '@/components/legal/legal-document';
import { legalPageMetadata } from '@/lib/legal-pages';

export const metadata: Metadata = legalPageMetadata('privacy-notice');

export default function PrivacyNoticePage() {
  return <LegalDocumentPage id="privacy-notice" />;
}
