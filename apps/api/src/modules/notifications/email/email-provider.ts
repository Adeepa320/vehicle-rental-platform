/** A rendered, ready-to-send e-mail. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Delivery adapter. Local development uses SMTP to Mailpit; tests use the
 * in-memory provider; production can plug in any SMTP server or an HTTP API
 * provider (e.g. Resend) without touching callers.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ messageId?: string }>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
