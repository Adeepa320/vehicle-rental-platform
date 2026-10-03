import { ApiException } from './errors/api.exception';

/** Keyset cursor over `(created_at DESC, id DESC)`. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const [iso, id] = decoded.split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new ApiException('VALIDATION_ERROR', 'Invalid pagination cursor', 400, [
      { field: 'cursor', issue: 'malformed' },
    ]);
  }
  return { createdAt, id };
}

/** Splits a `limit + 1` page into the page and the cursor for the next one. */
export function paginate<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return { data, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
