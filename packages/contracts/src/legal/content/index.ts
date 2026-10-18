import type { LegalDocument, LegalDocumentId } from '../legal';
import { CANCELLATION_POLICY } from './cancellation-policy';
import { PRIVACY_NOTICE } from './privacy-notice';
import { TERMS_OF_SERVICE } from './terms';

/** Every legal text the product shows, by id (Phase 10, TECH_DECISIONS D70). */
export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  'privacy-notice': PRIVACY_NOTICE,
  terms: TERMS_OF_SERVICE,
  'cancellation-policy': CANCELLATION_POLICY,
};

export { CANCELLATION_POLICY, PRIVACY_NOTICE, TERMS_OF_SERVICE };
