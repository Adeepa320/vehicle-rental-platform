import { Module } from '@nestjs/common';

import { BookingsCoreModule } from '../bookings/bookings-core.module';
import { EmailModule } from '../notifications/email/email.module';
import { NotificationsModule } from '../notifications/inapp/notifications.module';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

/**
 * Lean disputes (Phase 9, TECH_DECISIONS D62): participant routes here, the
 * admin queue and decisions in the admin facade, both over one service.
 */
@Module({
  imports: [BookingsCoreModule, EmailModule, NotificationsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
