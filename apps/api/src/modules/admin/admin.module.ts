import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsCoreModule } from '../bookings/bookings-core.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { DisputesModule } from '../disputes/disputes.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmailModule } from '../notifications/email/email.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProvidersModule } from '../providers/providers.module';
import { ReferenceModule } from '../reference/reference.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminDisputesController } from './admin-disputes.controller';
import { AdminDocumentsController } from './admin-documents.controller';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminProviderApplicationsController } from './admin-provider-applications.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminReferenceController } from './admin-reference.controller';
import { AdminReferenceService } from './admin-reference.service';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminReviewService } from './admin-review.service';
import { AdminReviewsController } from './admin-reviews.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminVehicleReviewService } from './admin-vehicle-review.service';
import { AdminVehiclesController } from './admin-vehicles.controller';

/**
 * Admin facade (ARCHITECTURE §5.1): controllers guarded by `@Roles('admin',
 * 'super_admin')` (settings and reference-data writes: `super_admin`) over
 * the provider, catalogue, booking, payment, review, document and dispute
 * services, plus the Phase 9 operations services (users, settings, reference
 * data, audit viewer, reports, overview). Every mutation writes an
 * `audit_events` row inside its transaction.
 */
@Module({
  imports: [
    AuthModule,
    ProvidersModule,
    CatalogueModule,
    EmailModule,
    BookingsModule,
    BookingsCoreModule,
    PaymentsModule,
    ReviewsModule,
    DocumentsModule,
    DisputesModule,
    ReferenceModule,
  ],
  controllers: [
    AdminOverviewController,
    AdminProviderApplicationsController,
    AdminProvidersController,
    AdminVehiclesController,
    AdminBookingsController,
    AdminPaymentsController,
    AdminReviewsController,
    AdminUsersController,
    AdminDocumentsController,
    AdminDisputesController,
    AdminSettingsController,
    AdminReferenceController,
    AdminAuditController,
    AdminReportsController,
  ],
  providers: [
    AdminReviewService,
    AdminVehicleReviewService,
    AdminUsersService,
    AdminSettingsService,
    AdminReferenceService,
    AdminAuditService,
    AdminReportsService,
    AdminOverviewService,
  ],
  // The privacy module completes deletion requests through the same anonymisation (Phase 10).
  exports: [AdminUsersService],
})
export class AdminModule {}
