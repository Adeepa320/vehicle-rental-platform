import { randomInt } from 'node:crypto';

/**
 * Booking references are short codes both parties can read over the phone:
 * `SLR-7F3K2Q`. Alphabet without vowels (no accidental words) and without
 * I/L/O/U (Crockford base32 ambiguity rules). 30^6 ≈ 729 million codes; the
 * unique index remains the guard and the generator retries on collision.
 */
export const REFERENCE_ALPHABET = '0123456789BCDFGHJKMNPQRSTVWXYZ';
export const REFERENCE_PREFIX = 'SLR';
export const REFERENCE_LENGTH = 6;
export const REFERENCE_PATTERN = /^SLR-[0-9BCDFGHJKMNPQRSTVWXYZ]{6}$/;

export function generateBookingReference(
  random: (maxExclusive: number) => number = randomInt,
): string {
  let code = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[random(REFERENCE_ALPHABET.length)];
  }
  return `${REFERENCE_PREFIX}-${code}`;
}

/** Accepts user input in any case / with or without the dash. */
export function normaliseReference(input: string): string | null {
  const compact = input
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  const body = compact.startsWith(REFERENCE_PREFIX)
    ? compact.slice(REFERENCE_PREFIX.length)
    : compact;
  const candidate = `${REFERENCE_PREFIX}-${body}`;
  return REFERENCE_PATTERN.test(candidate) ? candidate : null;
}
