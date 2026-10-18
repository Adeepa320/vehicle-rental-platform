import {
  LEGAL_DOCUMENTS,
  isLegalDocumentPublishable,
  legalMarkersRemaining,
  type LegalDocumentId,
} from '@vrp/contracts';
import { notFound } from 'next/navigation';

import { isLegalPageVisible, segmentLegalText } from '@/lib/legal-pages';

/** Inline text with `[PLACEHOLDER: …]` and `[LEGAL REVIEW REQUIRED]` markers highlighted. */
export function LegalText({ text }: { text: string }) {
  return (
    <>
      {segmentLegalText(text).map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <mark
            key={index}
            className={
              segment.kind === 'review'
                ? 'rounded-sm bg-red-100 px-1 font-medium text-red-900 dark:bg-red-950 dark:text-red-100'
                : 'rounded-sm bg-amber-100 px-1 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100'
            }
            title={segment.kind === 'review' ? 'Needs legal review' : 'Placeholder to be filled in'}
          >
            {segment.value}
          </mark>
        ),
      )}
    </>
  );
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Renders one legal document from `@vrp/contracts`. Drafts are withheld in
 * production (404 via `notFound()`) and shown with a banner everywhere else.
 */
export function LegalDocumentPage({ id }: { id: LegalDocumentId }) {
  const doc = LEGAL_DOCUMENTS[id];
  if (!isLegalPageVisible(doc)) notFound();
  const publishable = isLegalDocumentPublishable(doc);
  const markers = legalMarkersRemaining(doc);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      {!publishable ? (
        <div
          role="status"
          className="rounded-md border-2 border-red-600 bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p className="text-base font-semibold">DRAFT — not yet approved</p>
          <p className="mt-1">
            This text has not been approved for publication and does not apply yet. Approval
            required from: {doc.approvalRequiredFrom.join(', ')}.
            {markers.length > 0 ? ` Open items: ${markers.join(', ')}.` : ''}
          </p>
        </div>
      ) : null}

      <header className="grid gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="text-muted-foreground text-sm">
          Version {doc.version} · Last updated {formatDate(doc.lastUpdated)} ·{' '}
          {doc.effectiveFrom
            ? `Effective from ${formatDate(doc.effectiveFrom)}`
            : 'Not yet in effect'}
        </p>
        <p className="text-lg">
          <LegalText text={doc.summary} />
        </p>
      </header>

      <nav aria-label="Contents" className="rounded-md border p-4 text-sm">
        <p className="mb-2 font-medium">Contents</p>
        <ol className="grid gap-1 pl-5 [list-style:decimal]">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="underline underline-offset-4">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <ol className="grid gap-8">
        {doc.sections.map((section, index) => (
          <li key={section.id}>
            <section aria-labelledby={`${section.id}-heading`} className="grid gap-3">
              <h2 id={section.id} className="scroll-mt-4 text-xl font-semibold">
                <span id={`${section.id}-heading`}>
                  {index + 1}. {section.heading}
                </span>
              </h2>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i} className="leading-relaxed">
                  <LegalText text={paragraph} />
                </p>
              ))}
              {section.bullets.length > 0 ? (
                <ul className="grid gap-1 pl-5 leading-relaxed [list-style:disc]">
                  {section.bullets.map((bullet, i) => (
                    <li key={i}>
                      <LegalText text={bullet} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </li>
        ))}
      </ol>
    </main>
  );
}
