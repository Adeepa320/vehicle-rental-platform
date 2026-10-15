/**
 * Helpers for authenticated binary responses. Private documents and CSV
 * exports are fetched with the bearer token and handed to the browser as
 * short-lived object URLs; they are never plain links the user could share.
 */

/** Opens the blob in a new tab (PDF / image preview) and revokes the URL afterwards. */
export function openBlobInNewTab(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener');
  // Give the new tab time to load the object before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), opened ? 60_000 : 0);
  if (!opened) downloadBlob(blob, 'document');
}

/** Triggers a download with the given file name. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
