import { Module } from '@nestjs/common';

import { BookingsCoreModule } from '../bookings/bookings-core.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { EmailModule } from '../notifications/email/email.module';
import { NotificationsModule } from '../notifications/inapp/notifications.module';
import { ProvidersModule } from '../providers/providers.module';
import { DocumentExpiryService } from './document-expiry.service';
import { DocumentsService } from './documents.service';
import { ProviderDocumentsController } from './provider-documents.controller';

/**
 * Private verification documents (Phase 9, TECH_DECISIONS D61): provider
 * uploads and downloads, the admin review service (controllers live in the
 * admin facade) and the daily expiry sweep used by the worker.
 */
@Module({
  imports: [ProvidersModule, CatalogueModule, BookingsCoreModule, EmailModule, NotificationsModule],
  controllers: [ProviderDocumentsController],
  providers: [DocumentsService, DocumentExpiryService],
  exports: [DocumentsService, DocumentExpiryService],
})
export class DocumentsModule {}
