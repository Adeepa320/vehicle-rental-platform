import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Application-level encryption for sensitive columns (SECURITY_AND_PRIVACY §9,
 * TECH_DECISIONS D68): AES-256-GCM with a random 96-bit nonce, the 128-bit
 * authentication tag and the row identity as additional authenticated data,
 * so a ciphertext cannot be moved to another row. Envelopes are
 * `v1.<keyId>.<nonce>.<tag>.<ciphertext>` (base64url), and `keyId` (the first
 * eight hex characters of SHA-256(key)) selects the key during a rotation:
 * the previous key may decrypt, only the current key encrypts.
 */
export class DataEncryptionError extends Error {}

const VERSION = 'v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class DataEncryption {
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly currentKeyId: string;

  constructor(current: Buffer, previous?: Buffer) {
    if (current.length !== 32) throw new DataEncryptionError('encryption key must be 32 bytes');
    if (previous && previous.length !== 32) {
      throw new DataEncryptionError('previous encryption key must be 32 bytes');
    }
    const keys = new Map<string, Buffer>();
    this.currentKeyId = DataEncryption.keyId(current);
    keys.set(this.currentKeyId, current);
    if (previous) keys.set(DataEncryption.keyId(previous), previous);
    this.keys = keys;
  }

  static keyId(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 8);
  }

  get keyIds(): string[] {
    return [...this.keys.keys()];
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.keys.get(this.currentKeyId) as Buffer;
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      this.currentKeyId,
      nonce.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, aad: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) {
      throw new DataEncryptionError('malformed ciphertext envelope');
    }
    const [, keyId, nonce64, tag64, ciphertext64] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    const key = this.keys.get(keyId);
    if (!key) throw new DataEncryptionError(`no key for id ${keyId}`);
    const nonce = Buffer.from(nonce64, 'base64url');
    const tag = Buffer.from(tag64, 'base64url');
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
      throw new DataEncryptionError('malformed ciphertext envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext64, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new DataEncryptionError('ciphertext authentication failed');
    }
  }

  /** True when the envelope was produced with a key other than the current one (re-encrypt during rotation). */
  needsRotation(envelope: string): boolean {
    return envelope.split('.')[1] !== this.currentKeyId;
  }
}
