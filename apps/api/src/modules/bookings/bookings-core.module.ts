import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { NotificationsModule } from '../notifications/inapp/notifications.module';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingSettingsService } from './booking-settings.service';

/**
 * The part of the booking module the worker also needs (timers), without HTTP
 * controllers or the catalogue/storage dependencies of the full module.
 */
@Module({
  imports: [EmailModule, NotificationsModule],
  providers: [BookingSettingsService, BookingExpiryService],
  exports: [BookingSettingsService, BookingExpiryService, NotificationsModule],
})
export class BookingsCoreModule {}
