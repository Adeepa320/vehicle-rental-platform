import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env.schema';

/**
 * Loads `.env` (app directory first, then the repository root) and validates
 * the result with the Zod schema. Validation runs when this module is first
 * imported, so a misconfigured process fails before anything else starts.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
