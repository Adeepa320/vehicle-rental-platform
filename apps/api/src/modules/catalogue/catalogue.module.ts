import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { ProvidersModule } from '../providers/providers.module';
import { ReferenceModule } from '../reference/reference.module';
import { ProviderLocationsController } from './provider-locations.controller';
import { ProviderLocationsService } from './provider-locations.service';
import { ProviderVehiclesController } from './provider-vehicles.controller';
import { VehiclePhotosController } from './vehicle-photos.controller';
import { VehiclePhotosService } from './vehicle-photos.service';
import { VehiclesService } from './vehicles.service';

/**
 * Catalogue module (ARCHITECTURE §5.1): provider pickup locations, vehicle
 * listings with pricing/rules and the review lifecycle, and listing photos
 * (object storage via the global StorageModule). Documents remain deferred
 * (TECH_DECISIONS D37); availability lives in its own module.
 */
@Module({
  imports: [ProvidersModule, ReferenceModule, EmailModule],
  controllers: [ProviderLocationsController, ProviderVehiclesController, VehiclePhotosController],
  providers: [ProviderLocationsService, VehiclesService, VehiclePhotosService],
  exports: [ProviderLocationsService, VehiclesService, VehiclePhotosService],
})
export class CatalogueModule {}
