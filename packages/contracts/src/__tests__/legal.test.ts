import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CANCELLATION_POLICY,
  isLegalDocumentPublishable,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENTS,
  legalMarkersRemaining,
  LegalDocumentSchema,
  renderLegalMarkdown,
  type LegalDocumentId,
} from '../index';

/** Mirrors `scripts/render-legal.ts` (which lives outside `src` and cannot be imported here). */
const RENDERED_FILES: Record<LegalDocumentId, string> = {
  'privacy-notice': 'PRIVACY_NOTICE_DRAFT.md',
  terms: 'TERMS_DRAFT.md',
  'cancellation-policy': 'CANCELLATION_POLICY_DRAFT.md',
};

// src/__tests__ → src → packages/contracts → packages → repository root
const legalDocsDir = resolve(__dirname, '..', '..', '..', '..', 'docs', 'legal');

const documents = LEGAL_DOCUMENT_IDS.map((id) => [id, LEGAL_DOCUMENTS[id]] as const);

describe('legal documents', () => {
  it.each(documents)('%s parses with LegalDocumentSchema and carries its own id', (id, doc) => {
    const parsed = LegalDocumentSchema.safeParse(doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(doc.id).toBe(id);
    expect(doc.lastUpdated).toBe('2026-10-17');
    expect(doc.approvalRequiredFrom).toEqual(['Founder', 'Sri Lankan legal counsel']);
  });

  it.each(documents)('%s is a draft that is not publishable yet', (_id, doc) => {
    expect(doc.status).toBe('draft');
    expect(doc.effectiveFrom).toBeNull();
    expect(isLegalDocumentPublishable(doc)).toBe(false);
  });

  it.each(documents)('%s still lists its open markers', (_id, doc) => {
    const markers = legalMarkersRemaining(doc);
    expect(markers).toContain('LEGAL_REVIEW_REQUIRED');
    expect(markers).toContain('PLACEHOLDER:CONTROLLER_NAME');
    // A marker never hides in a heading: headings are navigation, not legal text.
    for (const section of doc.sections) {
      expect(section.heading).not.toMatch(/\[(PLACEHOLDER|LEGAL REVIEW)/);
    }
  });

  it.each(documents)('%s has unique section ids and no Markdown in its sentences', (_id, doc) => {
    const ids = doc.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of doc.sections) {
      for (const text of [...section.paragraphs, ...section.bullets]) {
        expect(text).not.toMatch(/^\s*(#|[-*]\s|\d+\.\s)/);
        expect(text).not.toMatch(/\*\*|`/);
      }
    }
  });

  it.each(documents)(
    '%s matches the committed docs/legal draft (run pnpm legal:render)',
    (id, doc) => {
      const file = resolve(legalDocsDir, RENDERED_FILES[id]);
      const committed = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      expect(committed).toBe(renderLegalMarkdown(doc));
    },
  );
});

describe('cancellation policy matches the implemented refund rule', () => {
  const text = [
    CANCELLATION_POLICY.summary,
    ...CANCELLATION_POLICY.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...section.bullets,
    ]),
  ].join('\n');

  it('states the default full-refund threshold of 48 hours', () => {
    expect(text).toContain('48');
    expect(text).toContain('cancellation_full_refund_hours');
  });

  it('uses the wording the booking pages and e-mails use', () => {
    expect(text).toContain('forfeited');
    expect(text).toContain('full refund');
    expect(text).toContain('recorded');
  });

  it('never promises an automatic refund', () => {
    expect(text).toContain('Refunds are not automatic');
    expect(text).not.toMatch(/refunded automatically(?! after a no-show)/);
  });

  it('covers provider, platform and late-payment refunds', () => {
    const headings = CANCELLATION_POLICY.sections.map((section) => section.id);
    expect(headings).toEqual(
      expect.arrayContaining([
        'customer-cancellation-after-payment',
        'provider-cancellation',
        'platform-cancellation',
        'how-refunds-are-made',
        'late-payments',
        'no-show',
      ]),
    );
  });
});
