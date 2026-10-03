export type StorageBucket = 'public' | 'private';

export interface PutObjectInput {
  bucket: StorageBucket;
  key: string;
  body: Buffer;
  contentType: string;
  /** e.g. `public, max-age=31536000, immutable` for versioned public variants. */
  cacheControl?: string;
}

/**
 * Minimal object-storage abstraction (TECH_DECISIONS D42). Business code
 * never sees bucket names, credentials or SDK types: it puts/deletes by
 * logical bucket and server-generated key, and asks for the public URL of a
 * key. `S3StorageProvider` talks to MinIO locally and to any S3-compatible
 * service later; `MemoryStorageProvider` backs the automated tests.
 */
export interface StorageProvider {
  readonly kind: 's3' | 'memory';
  /** Creates the buckets (and the public-read policy) when allowed; idempotent. */
  ensureBuckets(): Promise<void>;
  put(input: PutObjectInput): Promise<void>;
  /** Returns null when the object does not exist. */
  get(bucket: StorageBucket, key: string): Promise<Buffer | null>;
  delete(bucket: StorageBucket, keys: readonly string[]): Promise<void>;
  /** Absolute URL at which a key in the public bucket is served. */
  publicUrl(key: string): string;
}

/** Keys are built by the server from UUIDs and fixed words; this guards against anything else. */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,254}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Refusing unsafe storage key: ${key}`);
  }
}
