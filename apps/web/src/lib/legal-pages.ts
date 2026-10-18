import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  LEGAL_REVIEW_MARKER,
  PLACEHOLDER_PATTERN,
  isLegalDocumentPublishable,
  type LegalDocument,
  type LegalDocumentId,
} from '@vrp/contracts';
import type { Metadata } from 'next';

import { noIndexMetadata, publicPageMetadata } from '@/lib/seo';

/** Public paths of the legal texts (Phase 10, TECH_DECISIONS D70). */
export const LEGAL_ROUTES: Record<LegalDocumentId, string> = {
  'privacy-notice': '/privacy',
  terms: '/terms',
  'cancellation-policy': '/cancellation-policy',
};

const isProduction = process.env.NODE_ENV === 'production';

/** Drafts are shown locally with a banner and withheld (404) in production. */
export function isLegalPageVisible(doc: LegalDocument): boolean {
  return !isProduction || isLegalDocumentPublishable(doc);
}

/** Footer links for the documents that may be shown in this environment. */
export function legalLinks(): { href: string; label: string }[] {
  return LEGAL_DOCUMENT_IDS.map((id) => LEGAL_DOCUMENTS[id])
    .filter(isLegalPageVisible)
    .map((doc) => ({ href: LEGAL_ROUTES[doc.id], label: doc.title }));
}

/** Summary without draft markers, for `<meta name="description">`. */
export function stripLegalMarkers(text: string): string {
  return text
    .replace(PLACEHOLDER_PATTERN, '')
    .replaceAll(LEGAL_REVIEW_MARKER, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function legalPageMetadata(id: LegalDocumentId): Metadata {
  const doc = LEGAL_DOCUMENTS[id];
  return {
    ...publicPageMetadata({
      title: doc.title,
      description: stripLegalMarkers(doc.summary),
      path: LEGAL_ROUTES[id],
    }),
    ...(isLegalPageVisible(doc) ? {} : noIndexMetadata),
  };
}

export type LegalTextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'placeholder'; value: string }
  | { kind: 'review'; value: string };

const MARKER_PATTERN = /\[PLACEHOLDER:[^\]]*\]|\[LEGAL REVIEW REQUIRED\]/g;

/** Splits a legal sentence into plain text and the markers that must be highlighted. */
export function segmentLegalText(text: string): LegalTextSegment[] {
  const segments: LegalTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const start = match.index;
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) });
    segments.push({
      kind: match[0] === LEGAL_REVIEW_MARKER ? 'review' : 'placeholder',
      value: match[0],
    });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  return segments;
}
