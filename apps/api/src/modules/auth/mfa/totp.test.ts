import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateRecoveryCode,
  generateTotpSecret,
  hotp,
  normaliseRecoveryCode,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B test vectors (SHA-1): secret = ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS: Array<[seconds: number, eightDigits: string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('base32', () => {
  it('round-trips and matches the RFC 4648 encoding of the RFC 6238 secret', () => {
    expect(base32Encode(RFC_SECRET)).toBe(RFC_SECRET_BASE32);
    expect(base32Decode(RFC_SECRET_BASE32)).toEqual(RFC_SECRET);
    expect(base32Decode('gezd gnbv-gy3tqojqgezdgnbvgy3tqojq=')).toEqual(RFC_SECRET);
    expect(() => base32Decode('ABC1')).toThrow(/invalid base32/);
    for (const length of [1, 5, 19, 20, 33]) {
      const bytes = Buffer.alloc(length, length);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });
});

describe('TOTP (RFC 6238)', () => {
  it('reproduces the RFC test vectors (8 digits) and their 6-digit truncation', () => {
    for (const [seconds, eight] of RFC_VECTORS) {
      const step = totpStep(seconds * 1000);
      expect(hotp(RFC_SECRET, step, 8)).toBe(eight);
      expect(totpCode(RFC_SECRET_BASE32, step)).toBe(eight.slice(-6));
    }
  });

  it('accepts the current step and one step of drift either way, newest match first', () => {
    const now = 1111111109 * 1000;
    const step = totpStep(now);
    expect(
      verifyTotp(RFC_SECRET_BASE32, totpCode(RFC_SECRET_BASE32, step), { nowMs: now }),
    ).toEqual({ valid: true, step });
    expect(
      verifyTotp(RFC_SECRET_BASE32, totpCode(RFC_SECRET_BASE32, step - 1), { nowMs: now }),
    ).toEqual({ valid: true, step: step - 1 });
    expect(
      verifyTotp(RFC_SECRET_BASE32, totpCode(RFC_SECRET_BASE32, step + 1), { nowMs: now }),
    ).toEqual({ valid: true, step: step + 1 });
    expect(
      verifyTotp(RFC_SECRET_BASE32, totpCode(RFC_SECRET_BASE32, step + 2), { nowMs: now }),
    ).toEqual({ valid: false });
    expect(
      verifyTotp(RFC_SECRET_BASE32, totpCode(RFC_SECRET_BASE32, step - 2), { nowMs: now }),
    ).toEqual({ valid: false });
  });

  it('refuses malformed codes and replays of an already-used step', () => {
    const now = 1234567890 * 1000;
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET_BASE32, step);
    expect(verifyTotp(RFC_SECRET_BASE32, '12345', { nowMs: now })).toEqual({ valid: false });
    expect(verifyTotp(RFC_SECRET_BASE32, 'abcdef', { nowMs: now })).toEqual({ valid: false });
    expect(verifyTotp(RFC_SECRET_BASE32, code, { nowMs: now, lastUsedStep: step })).toEqual({
      valid: false,
    });
    expect(verifyTotp(RFC_SECRET_BASE32, code, { nowMs: now, lastUsedStep: step - 1 })).toEqual({
      valid: true,
      step,
    });
  });

  it('generates 160-bit base32 secrets and a standard otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    const uri = otpauthUri({
      issuer: 'Vehicle Rental Platform',
      account: 'ops@example.lk',
      secret,
    });
    expect(uri).toBe(
      `otpauth://totp/Vehicle%20Rental%20Platform:ops%40example.lk?secret=${secret}&issuer=Vehicle+Rental+Platform&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it('generates recovery codes in two groups and normalises user input', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(normaliseRecoveryCode(code)).toBe(code.replace('-', ''));
    expect(normaliseRecoveryCode(' k7qt3 6mz2w ')).toBe('K7QT36MZ2W');
  });
});
