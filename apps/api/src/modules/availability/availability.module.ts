import { Module } from '@nestjs/common';

import { CatalogueModule } from '../catalogue/catalogue.module';
import { ProvidersModule } from '../providers/providers.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

/**
 * Availability module (ARCHITECTURE §5.1): `vehicle_holds` is the single
 * source of unavailability. Phase 4 exposes provider manual blocks and a
 * window check; booking holds are added by the booking module later through
 * this module's service (`createHold` on the same table).
 */
@Module({
  imports: [ProvidersModule, CatalogueModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
