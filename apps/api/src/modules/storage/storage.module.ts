import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/** Object storage (MinIO locally, S3-compatible later). Global: used by the catalogue and discovery modules. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
