import { describe, expect, it } from 'vitest';

import { parseEwkbPoint, toEwkbPointHex } from '../geo/ewkb';

describe('parseEwkbPoint', () => {
  it('round-trips a Sri Lankan coordinate', () => {
    const hex = toEwkbPointHex({ lat: 5.9549, lng: 80.555 });
    expect(parseEwkbPoint(hex)).toEqual({ lat: 5.9549, lng: 80.555 });
  });

  it('parses a known PostGIS EWKB string (SRID 4326, little endian)', () => {
    // SELECT ST_SetSRID(ST_MakePoint(80.555, 5.9549), 4326)::geography
    const hex = toEwkbPointHex({ lat: 5.9549, lng: 80.555 });
    expect(hex.startsWith('0101000020E6100000')).toBe(true); // 01 = LE, 01000020 = Point|SRID, E6100000 = 4326
    expect(parseEwkbPoint(hex.toLowerCase())).toEqual({ lat: 5.9549, lng: 80.555 });
  });

  it('rejects non-point geometries and malformed input', () => {
    const lineString = toEwkbPointHex({ lat: 0, lng: 0 }).replace(/^0101000020/, '0102000020');
    expect(() => parseEwkbPoint(lineString)).toThrow(/not a Point/);
    expect(() => parseEwkbPoint('zz')).toThrow(/hex string/);
    expect(() => parseEwkbPoint('0101000020E6100000')).toThrow(/hex string/);
  });
});
