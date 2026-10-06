import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { EmailModule } from '../notifications/email/email.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminProviderApplicationsController } from './admin-provider-applications.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminVehicleReviewService } from './admin-vehicle-review.service';
import { AdminVehiclesController } from './admin-vehicles.controller';
import { AdminReviewService } from './admin-review.service';

/**
 * Admin facade (ARCHITECTURE §5.1): controllers guarded by `@Roles('admin',
 * 'super_admin')` over the provider, catalogue and booking services. Provider
 * and vehicle review, booking inspection and the temporary Phase 6 booking
 * confirmation; no dashboard, no unrelated metrics.
 */
@Module({
  imports: [ProvidersModule, CatalogueModule, EmailModule, BookingsModule, PaymentsModule],
  controllers: [
    AdminProviderApplicationsController,
    AdminProvidersController,
    AdminVehiclesController,
    AdminBookingsController,
    AdminPaymentsController,
  ],
  providers: [AdminReviewService, AdminVehicleReviewService],
})
export class AdminModule {}
