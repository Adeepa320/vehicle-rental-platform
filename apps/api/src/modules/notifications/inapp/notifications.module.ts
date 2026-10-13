import { Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * In-app notification feed (Phase 8, TECH_DECISIONS D58). Business modules
 * import this and call `NotificationsService.create(tx, …)` next to their
 * e-mail enqueue; the controller serves the caller's own feed.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
