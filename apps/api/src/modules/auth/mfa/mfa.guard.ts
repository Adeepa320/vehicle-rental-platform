import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiException } from '../../../common/errors/api.exception';
import type { AuthenticatedRequest } from '../auth.types';
import { MFA_EXEMPT_KEY } from '../decorators/mfa-exempt.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { MfaService, isPrivileged } from './mfa.service';

/**
 * Global guard evaluated after `RolesGuard` (Phase 10, TECH_DECISIONS D67).
 * When the admin-MFA policy is on, an account holding `admin` / `super_admin`
 * may only use `@Public()` and `@MfaExempt()` routes until its session carries
 * a verified factor — the server-set `mfa` claim, never anything the client
 * sends. The error tells the web app which step is missing.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly mfa: MfaService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.mfa.required) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user || !isPrivileged(user.roles) || user.mfaVerified) return true;
    if (this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT_KEY, targets)) return true;
    throw new ApiException(
      'MFA_REQUIRED',
      user.mfaEnrolled
        ? 'Complete two-factor authentication to continue'
        : 'Set up two-factor authentication to use administrator features',
      403,
      [{ field: 'mfa', issue: user.mfaEnrolled ? 'challenge_required' : 'enrolment_required' }],
    );
  }
}
