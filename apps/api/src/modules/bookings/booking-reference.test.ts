import { describe, expect, it } from 'vitest';

import {
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
  generateBookingReference,
  normaliseReference,
} from './booking-reference';

describe('booking references', () => {
  it('generates SLR-XXXXXX codes from the vowel-free alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const reference = generateBookingReference();
      expect(reference).toMatch(REFERENCE_PATTERN);
      for (const char of reference.slice(4)) expect(REFERENCE_ALPHABET).toContain(char);
    }
    expect(REFERENCE_ALPHABET).not.toMatch(/[AEIOULaeioul]/);
  });

  it('is deterministic for a given random source', () => {
    const zeros = generateBookingReference(() => 0);
    expect(zeros).toBe('SLR-000000');
    const last = generateBookingReference((max) => max - 1);
    expect(last).toBe('SLR-ZZZZZZ');
  });

  it('normalises user input and rejects anything else', () => {
    expect(normaliseReference(' slr-7f3k2q ')).toBe('SLR-7F3K2Q');
    expect(normaliseReference('7F3K2Q')).toBe('SLR-7F3K2Q');
    expect(normaliseReference('SLR 7F3K 2Q')).toBe('SLR-7F3K2Q');
    expect(normaliseReference('SLR-7F3K2A')).toBeNull();
    expect(normaliseReference('nope')).toBeNull();
  });
});
