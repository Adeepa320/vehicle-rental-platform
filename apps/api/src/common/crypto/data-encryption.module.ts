import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { DEV_DATA_ENCRYPTION_KEY, decodeEncryptionKey, type Env } from '../../config/env.schema';
import { DataEncryption } from './data-encryption';

/**
 * The application data-encryption key as a Nest provider. Production requires
 * `APP_DATA_ENCRYPTION_KEY` (the env schema refuses the documented development
 * key there); development and tests fall back to that documented key so
 * ciphertexts are stable across restarts. The key material is never logged.
 */
@Injectable()
export class DataEncryptionService extends DataEncryption {
  constructor(config: ConfigService<Env, true>, logger: PinoLogger) {
    const configured = config.get('APP_DATA_ENCRYPTION_KEY', { infer: true });
    const previous = config.get('APP_DATA_ENCRYPTION_KEY_PREVIOUS', { infer: true });
    super(
      decodeEncryptionKey(configured ?? DEV_DATA_ENCRYPTION_KEY) as Buffer,
      previous ? (decodeEncryptionKey(previous) ?? undefined) : undefined,
    );
    logger.setContext(DataEncryptionService.name);
    if (!configured && config.get('NODE_ENV', { infer: true }) !== 'test') {
      logger.warn(
        'APP_DATA_ENCRYPTION_KEY not set: using the documented development key (refused in production)',
      );
    }
  }
}

@Global()
@Module({ providers: [DataEncryptionService], exports: [DataEncryptionService] })
export class DataEncryptionModule {}
