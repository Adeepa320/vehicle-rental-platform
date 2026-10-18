import { waitFor } from './api';
import { MAILPIT_URL } from './env';

interface MailpitSummary {
  ID: string;
  Subject: string;
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

async function search(to: string): Promise<MailpitSummary[]> {
  const url = `${MAILPIT_URL}/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const data = (await response.json()) as { messages?: MailpitSummary[] };
  return data.messages ?? [];
}

/** Waits for a message to `to` whose subject contains `subjectPart` and returns it. */
export async function waitForEmail(
  to: string,
  subjectPart: string,
  timeoutMs = 45_000,
): Promise<MailpitMessage> {
  return waitFor(
    async () => {
      const hit = (await search(to)).find((m) => m.Subject.includes(subjectPart));
      if (!hit) return undefined;
      const response = await fetch(`${MAILPIT_URL}/message/${hit.ID}`);
      if (!response.ok) throw new Error(`Mailpit message failed: ${response.status}`);
      return (await response.json()) as MailpitMessage;
    },
    {
      timeoutMs,
      intervalMs: 750,
      what: `an e-mail to ${to} with a subject containing "${subjectPart}"`,
    },
  );
}

/** The one-time token carried by verification / reset links (`?token=…`). */
export function extractToken(text: string): string {
  const match = /token=([A-Za-z0-9._~-]+)/.exec(text);
  if (!match?.[1]) throw new Error('No token link found in the e-mail text');
  return match[1];
}
