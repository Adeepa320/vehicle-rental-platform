import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailMessage, EmailProvider } from './email-provider';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** SMTP delivery (Mailpit locally; any SMTP relay or provider SMTP endpoint in production). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user ? { auth: { user: options.user, pass: options.pass ?? '' } } : {}),
    });
  }

  async send(message: EmailMessage): Promise<{ messageId?: string }> {
    const info = await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    return { messageId: info.messageId };
  }
}
