import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { ReferenceModule } from '../reference/reference.module';
import { UsersModule } from '../users/users.module';
import { ActiveProviderGuard } from './guards/active-provider.guard';
import { ProviderApplicationsService } from './provider-applications.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

@Module({
  imports: [UsersModule, ReferenceModule, EmailModule],
  controllers: [ProvidersController],
  providers: [ProviderApplicationsService, ProvidersService, ActiveProviderGuard],
  exports: [ProviderApplicationsService, ProvidersService, ActiveProviderGuard],
})
export class ProvidersModule {}
