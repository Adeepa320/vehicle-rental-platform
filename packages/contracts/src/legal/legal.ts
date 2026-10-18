import { z } from 'zod';

/**
 * Legal texts as typed content (Phase 10, TECH_DECISIONS D70). The privacy
 * notice, terms and cancellation policy live here as structured sections so
 * the web pages, the generated `docs/legal/*_DRAFT.md` files and the
 * drift tests all read one source. A document is publishable only when its
 * status is `approved` and no `[PLACEHOLDER: …]` / `[LEGAL REVIEW REQUIRED]`
 * marker remains; until then the public pages show a draft banner locally and
 * are withheld in production (`production:check` reports the gate).
 */
export const LEGAL_DOCUMENT_IDS = ['privacy-notice', 'terms', 'cancellation-policy'] as const;
export const LegalDocumentIdSchema = z.enum(LEGAL_DOCUMENT_IDS);
export type LegalDocumentId = z.infer<typeof LegalDocumentIdSchema>;

export const LegalDocumentStatusSchema = z.enum(['draft', 'approved']);
export type LegalDocumentStatus = z.infer<typeof LegalDocumentStatusSchema>;

/** Version strings stamped on accounts (`users.terms_version`, `users.privacy_version`). */
export const CURRENT_PRIVACY_VERSION = '2026-10' as const;
export const CURRENT_CANCELLATION_POLICY_VERSION = '2026-10' as const;

export const PLACEHOLDER_PATTERN = /\[PLACEHOLDER:\s*([A-Z0-9_]+)[^\]]*\]/g;
export const LEGAL_REVIEW_MARKER = '[LEGAL REVIEW REQUIRED]';

export const LegalSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  heading: z.string().min(1).max(120),
  /** Plain sentences; a paragraph may carry `[PLACEHOLDER: KEY …]` or `[LEGAL REVIEW REQUIRED]` markers. */
  paragraphs: z.array(z.string().min(1)).default([]),
  bullets: z.array(z.string().min(1)).default([]),
});
export type LegalSection = z.infer<typeof LegalSectionSchema>;

export const LegalDocumentSchema = z.object({
  id: LegalDocumentIdSchema,
  title: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  status: LegalDocumentStatusSchema,
  /** ISO date the text was last changed. */
  lastUpdated: z.iso.date(),
  /** ISO date it applies from; null while a draft. */
  effectiveFrom: z.iso.date().nullable(),
  /** One or two plain sentences shown above the document. */
  summary: z.string().min(1).max(600),
  /** Who must approve before `status` may become `approved`. */
  approvalRequiredFrom: z.array(z.string().min(1)).min(1),
  sections: z.array(LegalSectionSchema).min(1),
});
export type LegalDocument = z.infer<typeof LegalDocumentSchema>;

/** Placeholder keys and review markers still present in the text. */
export function legalMarkersRemaining(doc: LegalDocument): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) found.add(`PLACEHOLDER:${match[1]}`);
    if (text.includes(LEGAL_REVIEW_MARKER)) found.add('LEGAL_REVIEW_REQUIRED');
  };
  scan(doc.summary);
  for (const section of doc.sections) {
    scan(section.heading);
    section.paragraphs.forEach(scan);
    section.bullets.forEach(scan);
  }
  return [...found].sort();
}

/** Approved and free of placeholders: safe to show to the public as final. */
export function isLegalDocumentPublishable(doc: LegalDocument): boolean {
  return doc.status === 'approved' && legalMarkersRemaining(doc).length === 0;
}

/** Deterministic Markdown used for `docs/legal/*_DRAFT.md` (kept in sync by a test). */
export function renderLegalMarkdown(doc: LegalDocument): string {
  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `**Status:** ${doc.status === 'draft' ? 'DRAFT — not approved for publication' : 'Approved'} · **Version:** ${doc.version} · **Last updated:** ${doc.lastUpdated}${doc.effectiveFrom ? ` · **Effective from:** ${doc.effectiveFrom}` : ''}`,
    '',
    `> Generated from \`packages/contracts/src/legal/content/${doc.id}.ts\` by \`pnpm legal:render\`; edit the source, not this file. Approval required from: ${doc.approvalRequiredFrom.join(', ')}.`,
    '',
    doc.summary,
    '',
  ];
  const markers = legalMarkersRemaining(doc);
  if (markers.length > 0) {
    lines.push(`**Open before approval:** ${markers.join(', ')}`, '');
  }
  doc.sections.forEach((section, index) => {
    lines.push(`## ${index + 1}. ${section.heading}`, '');
    for (const paragraph of section.paragraphs) lines.push(paragraph, '');
    if (section.bullets.length > 0) {
      for (const bullet of section.bullets) lines.push(`- ${bullet}`);
      lines.push('');
    }
  });
  return `${lines.join('\n').trimEnd()}\n`;
}
