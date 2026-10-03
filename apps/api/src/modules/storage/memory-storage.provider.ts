import {
  assertSafeKey,
  type PutObjectInput,
  type StorageBucket,
  type StorageProvider,
} from './storage.provider';

/** In-process storage for automated tests; mirrors the S3 provider's contract exactly. */
export class MemoryStorageProvider implements StorageProvider {
  readonly kind = 'memory' as const;
  readonly objects = new Map<
    string,
    { body: Buffer; contentType: string; cacheControl?: string }
  >();

  constructor(private readonly publicBaseUrl: string) {}

  async ensureBuckets(): Promise<void> {
    // nothing to create
  }

  async put(input: PutObjectInput): Promise<void> {
    assertSafeKey(input.key);
    this.objects.set(`${input.bucket}:${input.key}`, {
      body: input.body,
      contentType: input.contentType,
      ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
    });
  }

  async get(bucket: StorageBucket, key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    return this.objects.get(`${bucket}:${key}`)?.body ?? null;
  }

  async delete(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      assertSafeKey(key);
      this.objects.delete(`${bucket}:${key}`);
    }
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }

  /** Test helper: keys currently stored in a bucket. */
  keys(bucket: StorageBucket): string[] {
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(`${bucket}:`))
      .map((k) => k.slice(bucket.length + 1));
  }
}
