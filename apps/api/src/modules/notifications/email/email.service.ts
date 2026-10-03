import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseExecutor } from '@vrp/database';
import { PinoLogger } from 'nestjs-pino';

import { JobsService } from '../../../jobs/jobs.service';
import { QUEUES } from '../../../jobs/queues';
import { EMAIL_PROVIDER, type EmailMessage, type EmailProvider } from './email-provider';

/** Masks an address for logs: `n***@example.com`. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

@Injectable()
export class EmailService {
  constructor(
    private readonly jobs: JobsService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailService.name);
  }

  /**
   * Queues a message for the worker. Pass the open transaction so the job is
   * committed together with the business write (e.g. the user row and token).
   * Message bodies may contain one-time links, so payloads are never logged.
   */
  async enqueue(message: EmailMessage, tx?: DatabaseExecutor): Promise<void> {
    await this.jobs.send(QUEUES.emailSend, message, tx ? { tx } : {});
    this.logger.debug({ to: maskEmail(message.to), subject: message.subject }, 'Email queued');
  }

  /** Delivers immediately through the configured provider (called by the worker handler). */
  async deliver(message: EmailMessage): Promise<void> {
    const result = await this.provider.send(message);
    this.logger.info(
      {
        to: maskEmail(message.to),
        subject: message.subject,
        provider: this.provider.name,
        messageId: result.messageId,
      },
      'Email delivered',
    );
  }
}
