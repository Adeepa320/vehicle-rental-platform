import { Module } from '@nestjs/common';

import { BookingsCoreModule } from '../bookings/bookings-core.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { ProvidersModule } from '../providers/providers.module';
import { DiscoveryService } from './discovery.service';
import { PlacesController, PublicVehiclesController } from './public-vehicles.controller';

/**
 * Public discovery (ARCHITECTURE §5.1 "search"): customer-safe search and
 * listing pages over the catalogue, availability and gazetteer. Read-only;
 * no booking or quote engine yet (TECH_DECISIONS D44).
 */
@Module({
  imports: [CatalogueModule, ProvidersModule, BookingsCoreModule],
  controllers: [PublicVehiclesController, PlacesController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
