import { describe, expect, it } from 'vitest';

import { DEV_DATA_ENCRYPTION_KEY, decodeEncryptionKey } from '../../config/env.schema';
import { DataEncryption, DataEncryptionError } from './data-encryption';

const current = Buffer.alloc(32, 1);
const previous = Buffer.alloc(32, 2);

describe('DataEncryption (AES-256-GCM envelopes)', () => {
  it('round-trips text with a fresh nonce every time and binds the row identity', () => {
    const enc = new DataEncryption(current);
    const a = enc.encrypt('JBSWY3DPEHPK3PXP', 'user:1');
    const b = enc.encrypt('JBSWY3DPEHPK3PXP', 'user:1');
    expect(a).not.toBe(b);
    expect(a.startsWith(`v1.${DataEncryption.keyId(current)}.`)).toBe(true);
    expect(enc.decrypt(a, 'user:1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => enc.decrypt(a, 'user:2')).toThrow(DataEncryptionError);
  });

  it('detects tampering with the ciphertext, the tag and the nonce', () => {
    const enc = new DataEncryption(current);
    const envelope = enc.encrypt('secret', 'row');
    const parts = envelope.split('.');
    const flip = (index: number) => {
      const copy = [...parts];
      const bytes = Buffer.from(copy[index] as string, 'base64url');
      bytes[0] = (bytes[0] as number) ^ 0xff;
      copy[index] = bytes.toString('base64url');
      return copy.join('.');
    };
    expect(() => enc.decrypt(flip(2), 'row')).toThrow(DataEncryptionError);
    expect(() => enc.decrypt(flip(3), 'row')).toThrow(DataEncryptionError);
    expect(() => enc.decrypt(flip(4), 'row')).toThrow(DataEncryptionError);
    expect(() => enc.decrypt('v0.x.y.z.w', 'row')).toThrow(/malformed/);
    expect(() => enc.decrypt('garbage', 'row')).toThrow(/malformed/);
  });

  it('decrypts with the previous key during a rotation but only encrypts with the current one', () => {
    const old = new DataEncryption(previous);
    const legacy = old.encrypt('totp-secret', 'user:9');
    const rotating = new DataEncryption(current, previous);
    expect(rotating.decrypt(legacy, 'user:9')).toBe('totp-secret');
    expect(rotating.needsRotation(legacy)).toBe(true);
    const fresh = rotating.encrypt('totp-secret', 'user:9');
    expect(rotating.needsRotation(fresh)).toBe(false);
    expect(fresh.split('.')[1]).toBe(DataEncryption.keyId(current));
    const afterRotation = new DataEncryption(current);
    expect(() => afterRotation.decrypt(legacy, 'user:9')).toThrow(/no key for id/);
  });

  it('refuses keys that are not 32 bytes and decodes the documented development key', () => {
    expect(() => new DataEncryption(Buffer.alloc(16))).toThrow(DataEncryptionError);
    expect(decodeEncryptionKey(DEV_DATA_ENCRYPTION_KEY)?.toString('utf8')).toBe(
      'vrp-local-development-key-32byte',
    );
    expect(decodeEncryptionKey('not base64!')).toBeNull();
    expect(decodeEncryptionKey(Buffer.alloc(31).toString('base64'))).toBeNull();
    expect(decodeEncryptionKey(Buffer.alloc(32, 5).toString('base64url'))).toHaveLength(32);
  });
});
