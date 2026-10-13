import {
  GENERAL_LICENSING_GUIDANCE,
  LICENSING_GUIDANCE_DISCLAIMER,
  licensingGuidanceFor,
} from '@vrp/contracts';

/**
 * Informational licensing guidance (PRD FR-T5). Static content from the
 * shared contracts; items that still need operator / legal confirmation are
 * labelled. It never decides eligibility: the provider checks the physical
 * licence at pickup.
 */
export function LicensingGuidance({
  categoryId,
  variant = 'full',
}: {
  categoryId: string;
  variant?: 'full' | 'compact';
}) {
  const category = licensingGuidanceFor(categoryId);
  const items = [...(category?.items ?? []), ...GENERAL_LICENSING_GUIDANCE];
  const body = (
    <div className="grid gap-2 text-sm">
      {category ? <p className="font-medium">{category.summary}</p> : null}
      <ul className="grid list-disc gap-1 pl-5">
        {items.map((item) => (
          <li key={item.id}>
            {item.text}
            {item.requiresConfirmation ? (
              <span className="text-muted-foreground"> (confirm before travelling)</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">{LICENSING_GUIDANCE_DISCLAIMER}</p>
    </div>
  );
  if (variant === 'compact') {
    return (
      <details className="rounded-md border p-3" data-testid="licensing-guidance">
        <summary className="cursor-pointer text-sm font-medium">
          Licence requirements and tourist guidance
        </summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return (
    <section className="grid gap-2 rounded-lg border p-4" data-testid="licensing-guidance">
      <h2 className="text-base font-semibold">Licence requirements and tourist guidance</h2>
      {body}
    </section>
  );
}
