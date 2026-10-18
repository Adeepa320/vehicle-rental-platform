import { Module } from '@nestjs/common';

import { BookingsCoreModule } from '../bookings/bookings-core.module';
import { RetentionService } from './retention.service';

/** Retention sweep (Phase 10): settings from the booking-settings reader; storage and audit are global. */
@Module({
  imports: [BookingsCoreModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
