import { Module } from '@nestjs/common';

import { CatalogueModule } from '../catalogue/catalogue.module';
import { EmailModule } from '../notifications/email/email.module';
import { ProvidersModule } from '../providers/providers.module';
import { BookingQuoteService } from './booking-quote.service';
import { BookingsCoreModule } from './bookings-core.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ProviderBookingsController } from './provider-bookings.controller';
import { QuotesController } from './quotes.controller';

/**
 * Booking module (ARCHITECTURE §5.1, Phase 6 lean lifecycle): quotes, booking
 * requests, provider decisions, the accept transaction that writes booking
 * holds into `vehicle_holds`, cancellations, handover records and contact
 * reveal. Payments arrive in Phase 7.
 */
@Module({
  imports: [BookingsCoreModule, ProvidersModule, CatalogueModule, EmailModule],
  controllers: [QuotesController, BookingsController, ProviderBookingsController],
  providers: [BookingsService, BookingQuoteService],
  exports: [BookingsService, BookingQuoteService],
})
export class BookingsModule {}
