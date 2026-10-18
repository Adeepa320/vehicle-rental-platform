import Link from 'next/link';

/** Shown (with a 404 status) when a legal text is not approved for publication yet. */
export default function LegalNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-24">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold">This page is not yet available</h1>
      <p className="text-muted-foreground">
        The document you asked for has not been published yet. Please check back later.
      </p>
      <Link href="/" className="underline underline-offset-4">
        Back to home
      </Link>
    </main>
  );
}
