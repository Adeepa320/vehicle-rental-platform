import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@vrp/contracts';

export const ROLES_KEY = 'auth:roles';

/** Requires the caller to hold at least one of the given roles (checked by `RolesGuard`). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
