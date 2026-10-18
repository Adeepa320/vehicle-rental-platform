import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits) and RFC 4648 base32,
 * implemented on Node's crypto so the authenticator-app factor needs no
 * dependency (TECH_DECISIONS D67). Verification returns the matched step so
 * callers can refuse a code that was already accepted (replay).
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted on either side of "now" (clock drift); RFC 6238 §5.2 recommends at most one. */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit random secret as base32 (what the authenticator app stores). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[19] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function totpStep(nowMs: number, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

export function totpCode(secretBase32: string, step: number): string {
  return hotp(base32Decode(secretBase32), step);
}

export interface VerifyTotpOptions {
  nowMs?: number;
  window?: number;
  /** Highest step already accepted for this secret; codes for that step or earlier are refused (replay). */
  lastUsedStep?: number | null;
}

export type VerifyTotpResult = { valid: true; step: number } | { valid: false };

/** Constant-time comparison against every step in the window; the newest matching step wins. */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: VerifyTotpOptions = {},
): VerifyTotpResult {
  if (!/^\d{6}$/.test(code)) return { valid: false };
  const now = totpStep(options.nowMs ?? Date.now());
  const window = options.window ?? TOTP_WINDOW;
  const secret = base32Decode(secretBase32);
  const candidate = Buffer.from(code);
  let matched: number | null = null;
  for (let step = now + window; step >= now - window; step -= 1) {
    const expected = Buffer.from(hotp(secret, step));
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      matched ??= step;
    }
  }
  if (matched === null) return { valid: false };
  if (
    options.lastUsedStep !== null &&
    options.lastUsedStep !== undefined &&
    matched <= options.lastUsedStep
  ) {
    return { valid: false };
  }
  return { valid: true, step: matched };
}

/** `otpauth://` URI consumed by authenticator apps (shown once, during enrolment). */
export function otpauthUri(input: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten characters from the base32 alphabet in two groups (≈ 50 bits), e.g. `K7QT3-9MZ2W`. */
export function generateRecoveryCode(): string {
  const raw = base32Encode(randomBytes(10)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

/** Canonical form used for hashing and lookup: upper-case alphabet characters only. */
export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}
