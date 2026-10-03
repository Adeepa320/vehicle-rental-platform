import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdminProviderApplicationsController } from './admin-provider-applications.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminReviewService } from './admin-review.service';

/**
 * Admin facade (ARCHITECTURE §5.1): controllers guarded by `@Roles('admin',
 * 'super_admin')` over the provider module's services. Phase 3 scope is
 * provider review only; no dashboard, no unrelated metrics.
 */
@Module({
  imports: [ProvidersModule, EmailModule],
  controllers: [AdminProviderApplicationsController, AdminProvidersController],
  providers: [AdminReviewService],
})
export class AdminModule {}
