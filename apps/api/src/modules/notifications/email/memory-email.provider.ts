import type { EmailMessage, EmailProvider } from './email-provider';

/** Captures messages in memory. Tests only (rejected by config validation in production). */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ messageId?: string }> {
    this.sent.push(message);
    return { messageId: `memory-${this.sent.length}` };
  }

  clear(): void {
    this.sent.length = 0;
  }
}
