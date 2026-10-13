import { Module } from '@nestjs/common';

import { BookingsCoreModule } from '../bookings/bookings-core.module';
import { EmailModule } from '../notifications/email/email.module';
import { NotificationsModule } from '../notifications/inapp/notifications.module';
import { ProvidersModule } from '../providers/providers.module';
import { ProviderReviewsController } from './provider-reviews.controller';
import { PublicReviewsController } from './public-reviews.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/**
 * Reviews (ARCHITECTURE §5.1 "trust", Phase 8): the customer's review of a
 * completed booking, the public listing, the provider's reply. Admin
 * moderation controllers live in the admin facade and use the same service.
 */
@Module({
  imports: [BookingsCoreModule, EmailModule, NotificationsModule, ProvidersModule],
  controllers: [ReviewsController, PublicReviewsController, ProviderReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
