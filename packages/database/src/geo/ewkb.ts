/** A WGS84 coordinate pair. `lat` is north/south, `lng` east/west. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

const WKB_POINT = 1;
const EWKB_FLAG_Z = 0x80000000;
const EWKB_FLAG_M = 0x40000000;
const EWKB_FLAG_SRID = 0x20000000;

/**
 * Parses the hex-encoded EWKB string PostgreSQL returns for a
 * `geography(Point, 4326)` column into `{ lat, lng }`.
 * Only 2-D points are supported, which is all the schema stores.
 */
export function parseEwkbPoint(hex: string): GeoPoint {
  if (typeof hex !== 'string' || hex.length < 42 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid EWKB point: expected a hex string');
  }
  const buf = Buffer.from(hex, 'hex');
  const littleEndian = buf.readUInt8(0) === 1;
  const typeWord = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  // Mask off the Z/M/SRID flag bits to get the base geometry type.
  const geometryType = (typeWord & 0x1fffffff) >>> 0;
  if (geometryType !== WKB_POINT) {
    throw new Error(`Invalid EWKB point: geometry type ${geometryType} is not a Point`);
  }
  if ((typeWord & (EWKB_FLAG_Z | EWKB_FLAG_M)) !== 0) {
    throw new Error('Invalid EWKB point: Z/M dimensions are not supported');
  }
  const offset = 5 + ((typeWord & EWKB_FLAG_SRID) !== 0 ? 4 : 0);
  if (buf.length < offset + 16) {
    throw new Error('Invalid EWKB point: truncated coordinates');
  }
  const x = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const y = littleEndian ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
  return { lng: x, lat: y };
}

/** Builds a little-endian EWKB (SRID 4326) hex string for a point. Used by tests and fixtures. */
export function toEwkbPointHex(point: GeoPoint, srid = 4326): string {
  const buf = Buffer.alloc(25);
  buf.writeUInt8(1, 0);
  buf.writeUInt32LE((WKB_POINT | EWKB_FLAG_SRID) >>> 0, 1);
  buf.writeUInt32LE(srid, 5);
  buf.writeDoubleLE(point.lng, 9);
  buf.writeDoubleLE(point.lat, 17);
  return buf.toString('hex').toUpperCase();
}
