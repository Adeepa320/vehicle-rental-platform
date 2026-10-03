import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.schema';
import { MemoryStorageProvider } from './memory-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import type { PutObjectInput, StorageBucket, StorageProvider } from './storage.provider';

/**
 * Facade over the configured `StorageProvider`. Buckets are created at startup
 * in development/test (`STORAGE_AUTO_CREATE_BUCKETS`); production buckets and
 * their public access are provisioned by the operator (TECH_DECISIONS D42).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  readonly provider: StorageProvider;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StorageService.name);
    const publicUrl = config.get('STORAGE_PUBLIC_URL', { infer: true });
    if (config.get('STORAGE_PROVIDER', { infer: true }) === 'memory') {
      this.provider = new MemoryStorageProvider(publicUrl);
    } else {
      this.provider = new S3StorageProvider({
        endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
        region: config.get('STORAGE_REGION', { infer: true }),
        accessKeyId: config.get('STORAGE_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('STORAGE_SECRET_KEY', { infer: true }),
        forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE', { infer: true }),
        buckets: {
          public: config.get('STORAGE_BUCKET_PUBLIC', { infer: true }),
          private: config.get('STORAGE_BUCKET_PRIVATE', { infer: true }),
        },
        publicUrl,
        autoCreateBuckets:
          config.get('STORAGE_AUTO_CREATE_BUCKETS', { infer: true }) ??
          config.get('NODE_ENV', { infer: true }) !== 'production',
      });
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.provider.ensureBuckets();
      this.logger.info({ provider: this.provider.kind }, 'Object storage ready');
    } catch (error) {
      // Startup continues: photo uploads will fail with a clear error until storage is reachable.
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Object storage is not reachable; photo uploads will fail until it is',
      );
    }
  }

  put(input: PutObjectInput): Promise<void> {
    return this.provider.put(input);
  }

  get(bucket: StorageBucket, key: string): Promise<Buffer | null> {
    return this.provider.get(bucket, key);
  }

  delete(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    return this.provider.delete(bucket, keys);
  }

  publicUrl(key: string): string {
    return this.provider.publicUrl(key);
  }
}
