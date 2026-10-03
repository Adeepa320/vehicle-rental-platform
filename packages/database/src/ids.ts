import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUIDv7: 48-bit Unix millisecond timestamp + 74 random bits.
 * Time-ordered ids keep B-tree indexes compact for high-volume tables
 * (users, tokens, bookings) while remaining valid `uuid` values.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(nowMs);
  bytes.writeUInt8(Number((ts >> 40n) & 0xffn), 0);
  bytes.writeUInt8(Number((ts >> 32n) & 0xffn), 1);
  bytes.writeUInt8(Number((ts >> 24n) & 0xffn), 2);
  bytes.writeUInt8(Number((ts >> 16n) & 0xffn), 3);
  bytes.writeUInt8(Number((ts >> 8n) & 0xffn), 4);
  bytes.writeUInt8(Number(ts & 0xffn), 5);
  // Version 7 in the high nibble of byte 6; RFC 4122 variant (10xx) in byte 8.
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extracts the millisecond timestamp embedded in a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
