import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module';
import { EmailModule } from '../notifications/email/email.module';
import { NotificationsModule } from '../notifications/inapp/notifications.module';
import { AdminPrivacyRequestsController } from './admin-privacy-requests.controller';
import { PrivacyExportService } from './privacy-export.service';
import { PrivacyRequestsService } from './privacy-requests.service';
import { PrivacyController } from './privacy.controller';

/**
 * Data-subject rights (Phase 10, TECH_DECISIONS D69): the allow-listed export,
 * deletion requests and the operator queue. Deletion completes through the
 * Phase 9 `AdminUsersService.anonymise`, which is why the admin module is
 * imported here rather than duplicated.
 */
@Module({
  imports: [AdminModule, EmailModule, NotificationsModule],
  controllers: [PrivacyController, AdminPrivacyRequestsController],
  providers: [PrivacyExportService, PrivacyRequestsService],
  exports: [PrivacyExportService, PrivacyRequestsService],
})
export class PrivacyModule {}
