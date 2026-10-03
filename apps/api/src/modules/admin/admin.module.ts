import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdminProviderApplicationsController } from './admin-provider-applications.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminVehicleReviewService } from './admin-vehicle-review.service';
import { AdminVehiclesController } from './admin-vehicles.controller';
import { AdminReviewService } from './admin-review.service';

/**
 * Admin facade (ARCHITECTURE §5.1): controllers guarded by `@Roles('admin',
 * 'super_admin')` over the provider module's services. Phase 3 scope is
 * provider review only; no dashboard, no unrelated metrics.
 */
@Module({
  imports: [ProvidersModule, CatalogueModule, EmailModule],
  controllers: [
    AdminProviderApplicationsController,
    AdminProvidersController,
    AdminVehiclesController,
  ],
  providers: [AdminReviewService, AdminVehicleReviewService],
})
export class AdminModule {}
