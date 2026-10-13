import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DistrictSchema,
  ExchangeRatesResponseSchema,
  PlaceSummarySchema,
  PlacesQuerySchema,
  VehicleCategorySchema,
  type District,
  type ExchangeRatesResponse,
  type PlaceSummary,
  type PlacesQuery,
  type VehicleCategory,
} from '@vrp/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Public } from '../auth/decorators/public.decorator';
import { ReferenceService } from './reference.service';

/** Public, read-only reference data used by forms and (later) search. */
@ApiTags('reference')
@Public()
@Controller('reference')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('districts')
  @ApiOperation({ summary: 'All districts with their active (service-area) flag' })
  @ApiZodResponse(200, z.array(DistrictSchema))
  districts(): Promise<District[]> {
    return this.reference.listDistricts();
  }

  @Get('places')
  @ApiOperation({ summary: 'Active places, optionally filtered by district' })
  @ApiZodResponse(200, z.array(PlaceSummarySchema))
  places(
    @Query(new ZodValidationPipe(PlacesQuerySchema)) query: PlacesQuery,
  ): Promise<PlaceSummary[]> {
    return this.reference.listPlaces(query.districtId);
  }

  @Get('exchange-rates')
  @ApiOperation({
    summary: 'Indicative display rates (LKR base, operator-maintained; never used for pricing)',
  })
  @ApiZodResponse(200, ExchangeRatesResponseSchema)
  exchangeRates(): Promise<ExchangeRatesResponse> {
    return this.reference.exchangeRates();
  }

  @Get('vehicle-categories')
  @ApiOperation({ summary: 'Active vehicle categories' })
  @ApiZodResponse(200, z.array(VehicleCategorySchema))
  vehicleCategories(): Promise<VehicleCategory[]> {
    return this.reference.listVehicleCategories();
  }
}
