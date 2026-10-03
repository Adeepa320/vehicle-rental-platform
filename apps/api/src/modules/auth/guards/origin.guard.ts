import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { ApiException } from '../../../common/errors/api.exception';
import type { Env } from '../../../config/env.schema';

/**
 * CSRF defence for endpoints that accept the refresh-token cookie.
 *
 * Browsers always attach `Origin` to cross-origin requests and to same-origin
 * POSTs, so a request carrying an `Origin` (or `Referer`) outside the allowed
 * web origins is rejected. Requests without either header come from
 * non-browser clients, which cannot use the cookie anyway. Combined with
 * `SameSite=Lax` and the `/api/v1/auth` cookie path this blocks cross-site
 * refresh/logout attempts (SECURITY_AND_PRIVACY.md §2.2).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: ConfigService<Env, true>) {
    this.allowed = new Set(config.get('CORS_ORIGINS', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = resolveOrigin(request);
    if (!origin) return true;
    if (this.allowed.has(origin)) return true;
    throw new ApiException('FORBIDDEN', 'Request origin is not allowed', 403);
  }
}

function resolveOrigin(request: Request): string | undefined {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) return origin;
  const referer = request.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      return new URL(referer).origin;
    } catch {
      return 'invalid';
    }
  }
  return undefined;
}
