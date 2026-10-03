import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiException } from '../../../common/errors/api.exception';
import { UsersService } from '../../users/users.service';
import type { AuthenticatedRequest } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

/**
 * Global guard. Routes are protected by default; `@Public()` opts out.
 * Verifies the bearer JWT, then loads the user so suspension, deletion and
 * `sessions_revoked_at` (logout-all / password reset) take effect immediately
 * instead of after the access token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication required', 401);
    }

    const claims = await this.tokens
      .verifyAccessToken(header.slice('Bearer '.length).trim())
      .catch(() => {
        throw new ApiException('UNAUTHENTICATED', 'Invalid or expired access token', 401);
      });

    const user = await this.users.findAuthUserById(claims.sub);
    if (!user || user.status === 'deleted') {
      throw new ApiException('UNAUTHENTICATED', 'Invalid or expired access token', 401);
    }
    if (user.status === 'suspended') {
      throw new ApiException('ACCOUNT_SUSPENDED', 'This account has been suspended', 403);
    }
    if (
      user.sessionsRevokedAt &&
      claims.iat < Math.floor(user.sessionsRevokedAt.getTime() / 1000)
    ) {
      throw new ApiException('UNAUTHENTICATED', 'Session has been revoked', 401);
    }

    request.user = {
      id: user.id,
      email: user.email,
      roles: user.roles,
      sessionId: claims.sid,
    };
    return true;
  }
}
