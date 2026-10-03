import { users, type DatabaseExecutor, type User, type Vehicle } from '@vrp/database';
import { eq } from 'drizzle-orm';

import { ApiException } from '../../common/errors/api.exception';

/** Account that owns a provider profile (for notifications). */
export async function ownerOf(
  executor: DatabaseExecutor,
  userId: string,
): Promise<Pick<User, 'email' | 'fullName'>> {
  const [row] = await executor
    .select({ email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new ApiException('NOT_FOUND', 'Provider account not found', 404);
  return row;
}

/** PostgreSQL `exclusion_violation` (23P01), possibly wrapped by Drizzle. */
export function isExclusionViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
  return candidate?.code === '23P01' || candidate?.cause?.code === '23P01';
}

/** Display name for a vehicle in messages, even for sparse drafts. */
export function vehicleLabel(row: Pick<Vehicle, 'title' | 'make' | 'model' | 'modelYear'>): string {
  if (row.title) return row.title;
  const parts = [row.make, row.model, row.modelYear].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'your vehicle';
}

/** Public slug: `toyota-aqua-2018-mirissa-ab12` (make, model, year, town, random suffix). */
export function makeVehicleSlug(
  vehicle: Pick<Vehicle, 'make' | 'model' | 'modelYear'>,
  placeSlug: string | null,
): string {
  const base = [vehicle.make, vehicle.model, vehicle.modelYear, placeSlug]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${base || 'vehicle'}-${suffix}`;
}
