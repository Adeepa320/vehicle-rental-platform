/**
 * Renders every legal document to `docs/legal/*_DRAFT.md` (Phase 10,
 * TECH_DECISIONS D70). The TypeScript content under `src/legal/content` is the
 * single source; the Markdown files are generated artefacts that reviewers
 * read, and `src/__tests__/legal.test.ts` fails when they drift.
 *
 *   pnpm legal:render            (repo root)
 *   pnpm --filter @vrp/contracts legal:render
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGAL_DOCUMENTS } from '../src/legal/content';
import { renderLegalMarkdown, type LegalDocumentId } from '../src/legal/legal';

/** Output file per document id, relative to `docs/legal/`. */
const OUTPUT_FILES: Record<LegalDocumentId, string> = {
  'privacy-notice': 'PRIVACY_NOTICE_DRAFT.md',
  terms: 'TERMS_DRAFT.md',
  'cancellation-policy': 'CANCELLATION_POLICY_DRAFT.md',
};

// scripts/ → packages/contracts → packages → repository root
const repoRoot = resolve(__dirname, '..', '..', '..');
const outputDir = resolve(repoRoot, 'docs', 'legal');

mkdirSync(outputDir, { recursive: true });

for (const [id, fileName] of Object.entries(OUTPUT_FILES) as [LegalDocumentId, string][]) {
  const document = LEGAL_DOCUMENTS[id];
  const target = resolve(outputDir, fileName);
  writeFileSync(target, renderLegalMarkdown(document), 'utf8');
  process.stdout.write(`${id} (${document.status}, v${document.version}) -> ${target}\n`);
}
