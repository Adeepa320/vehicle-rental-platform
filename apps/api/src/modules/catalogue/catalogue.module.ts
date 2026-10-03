import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { ProvidersModule } from '../providers/providers.module';
import { ReferenceModule } from '../reference/reference.module';
import { ProviderLocationsController } from './provider-locations.controller';
import { ProviderLocationsService } from './provider-locations.service';
import { ProviderVehiclesController } from './provider-vehicles.controller';
import { VehiclesService } from './vehicles.service';

/**
 * Catalogue module (ARCHITECTURE §5.1): provider pickup locations and vehicle
 * listings with pricing/rules and the review lifecycle. Photos and documents
 * are deferred (TECH_DECISIONS D37); availability lives in its own module.
 */
@Module({
  imports: [ProvidersModule, ReferenceModule, EmailModule],
  controllers: [ProviderLocationsController, ProviderVehiclesController],
  providers: [ProviderLocationsService, VehiclesService],
  exports: [ProviderLocationsService, VehiclesService],
})
export class CatalogueModule {}
