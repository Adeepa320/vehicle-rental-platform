import { createHmac } from 'node:crypto';

import { sleep } from './api';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits) with RFC 4648 base32,
 * implemented on `node:crypto` so the suite can act as an authenticator app.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`invalid base32 character "${char}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
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

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secretBase32: string, step = totpStep()): string {
  return hotp(base32Decode(secretBase32), step);
}

/** Highest step already handed out per secret (the server refuses a code for a step it has accepted). */
const lastIssuedStep = new Map<string, number>();

/**
 * A code the server has not seen yet. The API accepts the current step and one
 * step on either side, so right after a code was used the next step's code is
 * returned immediately; only a third code within the same half minute waits
 * for the clock. Never reuses a step for the same secret in this process.
 */
export async function freshTotpCode(secretBase32: string): Promise<string> {
  const last = lastIssuedStep.get(secretBase32) ?? -1;
  const step = Math.max(totpStep(), last + 1);
  while (step > totpStep() + 1) {
    await sleep(250);
  }
  lastIssuedStep.set(secretBase32, step);
  return totpCode(secretBase32, step);
}
