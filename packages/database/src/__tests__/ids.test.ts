import { describe, expect, it } from 'vitest';

import { uuidv7, uuidv7Timestamp } from '../ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 ids with the correct variant', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(uuidv7()).toMatch(UUID_V7);
    }
  });

  it('embeds the millisecond timestamp and sorts by time', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(uuidv7Timestamp(earlier)).toBe(1_700_000_000_000);
    expect(uuidv7Timestamp(later)).toBe(1_700_000_000_001);
    expect(earlier < later).toBe(true);
  });

  it('never repeats within a burst', () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => uuidv7()));
    expect(ids.size).toBe(5_000);
  });
});
