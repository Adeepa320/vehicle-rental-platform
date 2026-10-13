import { Module } from '@nestjs/common';

import { BookingsCoreModule } from '../../bookings/bookings-core.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../inapp/notifications.module';
import { RemindersService } from './reminders.service';

/** Payment, pickup and review reminders (Phase 8); used by the worker and by tests. */
@Module({
  imports: [BookingsCoreModule, EmailModule, NotificationsModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
