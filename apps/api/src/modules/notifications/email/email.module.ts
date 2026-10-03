import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../config/env.schema';
import { JobsModule } from '../../../jobs/jobs.module';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider';
import { EmailService } from './email.service';
import { MemoryEmailProvider } from './memory-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

@Module({
  imports: [JobsModule],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmailProvider => {
        if (config.get('EMAIL_PROVIDER', { infer: true }) === 'memory') {
          return new MemoryEmailProvider();
        }
        return new SmtpEmailProvider({
          host: config.get('SMTP_HOST', { infer: true }),
          port: config.get('SMTP_PORT', { infer: true }),
          secure: config.get('SMTP_SECURE', { infer: true }),
          user: config.get('SMTP_USER', { infer: true }),
          pass: config.get('SMTP_PASS', { infer: true }),
          from: config.get('EMAIL_FROM', { infer: true }),
        });
      },
    },
    EmailService,
  ],
  exports: [EmailService, EMAIL_PROVIDER],
})
export class EmailModule {}
