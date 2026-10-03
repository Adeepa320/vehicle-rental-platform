import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ProviderProfile } from '@vrp/database';

import type { ProviderRequest } from '../guards/active-provider.guard';

/** The active provider profile attached by `ActiveProviderGuard`. */
export const CurrentProvider = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProviderProfile => {
    const provider = context.switchToHttp().getRequest<ProviderRequest>().provider;
    if (!provider) throw new Error('CurrentProvider used without ActiveProviderGuard');
    return provider;
  },
);
