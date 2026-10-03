import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { ProviderProfile } from '@vrp/database';

import { ApiException } from '../../../common/errors/api.exception';
import type { AuthenticatedRequest } from '../../auth/auth.types';
import { ProvidersService } from '../providers.service';

export interface ProviderRequest extends AuthenticatedRequest {
  provider?: ProviderProfile;
}

/**
 * For provider-only actions (vehicle management arrives in Phase 4). Requires
 * an approved provider profile in `active` standing; a suspended provider may
 * still read their profile but cannot act. Runs after the global auth guard.
 */
@Injectable()
export class ActiveProviderGuard implements CanActivate {
  constructor(private readonly providers: ProvidersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProviderRequest>();
    if (!request.user) {
      throw new ApiException('UNAUTHENTICATED', 'Authentication required', 401);
    }
    const profile = await this.providers.findByUserId(request.user.id);
    if (!profile) {
      throw new ApiException('FORBIDDEN', 'An approved provider account is required', 403);
    }
    if (profile.status !== 'active') {
      throw new ApiException('PROVIDER_SUSPENDED', 'Your provider account is suspended', 403);
    }
    request.provider = profile;
    return true;
  }
}
