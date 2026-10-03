import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@vrp/contracts';

import { ApiException } from '../../../common/errors/api.exception';
import type { AuthenticatedRequest } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Global guard evaluated after `JwtAuthGuard`. Routes without `@Roles()` pass.
 * Roles come from the database row loaded by the auth guard, not from the
 * token, so a role change applies on the next request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication required', 401);
    }
    if (!required.some((role) => user.roles.includes(role))) {
      throw new ApiException('FORBIDDEN', 'You do not have permission to perform this action', 403);
    }
    return true;
  }
}
