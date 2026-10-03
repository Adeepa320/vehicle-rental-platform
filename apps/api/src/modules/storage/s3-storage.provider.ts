import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import {
  assertSafeKey,
  type PutObjectInput,
  type StorageBucket,
  type StorageProvider,
} from './storage.provider';

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  buckets: { public: string; private: string };
  publicUrl: string;
  autoCreateBuckets: boolean;
}

/** MinIO locally; R2 / S3 / any S3-compatible endpoint later, same code. */
export class S3StorageProvider implements StorageProvider {
  readonly kind = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async ensureBuckets(): Promise<void> {
    if (!this.options.autoCreateBuckets) return;
    for (const bucket of [this.options.buckets.private, this.options.buckets.public]) {
      if (!(await this.bucketExists(bucket))) {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    }
    // Anonymous read of processed variants only; the private bucket keeps the default (no access).
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.options.buckets.public,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicRead',
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.options.buckets.public}/*`],
            },
          ],
        }),
      }),
    );
  }

  async put(input: PutObjectInput): Promise<void> {
    assertSafeKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName(input.bucket),
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.cacheControl ? { CacheControl: input.cacheControl } : {}),
      }),
    );
  }

  async get(bucket: StorageBucket, key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return null;
      throw error;
    }
  }

  async delete(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    for (const key of keys) assertSafeKey(key);
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucketName(bucket),
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.options.publicUrl.replace(/\/+$/, '')}/${key}`;
  }

  private bucketName(bucket: StorageBucket): string {
    return this.options.buckets[bucket];
  }

  private async bucketExists(bucket: string): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return false;
      throw error;
    }
  }
}
