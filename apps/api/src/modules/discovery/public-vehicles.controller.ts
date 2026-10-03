import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PlaceSuggestQuerySchema,
  PlaceSuggestionSchema,
  PublicVehicleDetailSchema,
  PublicVehicleQuerySchema,
  VehicleSearchQuerySchema,
  VehicleSearchResponseSchema,
  type PlaceSuggestQuery,
  type PlaceSuggestion,
  type PublicVehicleDetail,
  type PublicVehicleQuery,
  type VehicleSearchQuery,
  type VehicleSearchResponse,
} from '@vrp/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Public } from '../auth/decorators/public.decorator';
import { DiscoveryService } from './discovery.service';

const SlugOrIdPipe = new ZodValidationPipe(
  z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i, 'invalid vehicle reference'),
);

/** Customer-facing discovery: no authentication, customer-safe projections only. */
@ApiTags('public')
@Controller('vehicles')
export class PublicVehiclesController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('search')
  @ApiOperation({
    summary:
      'Search approved listings by place/district, dates, category and attributes; real availability from holds',
  })
  @ApiZodResponse(200, VehicleSearchResponseSchema)
  search(
    @Query(new ZodValidationPipe(VehicleSearchQuerySchema)) query: VehicleSearchQuery,
  ): Promise<VehicleSearchResponse> {
    return this.discovery.search(query);
  }

  @Public()
  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Public listing page data (approximate location, no private data)' })
  @ApiZodResponse(200, PublicVehicleDetailSchema)
  detail(
    @Param('idOrSlug', SlugOrIdPipe) idOrSlug: string,
    @Query(new ZodValidationPipe(PublicVehicleQuerySchema)) query: PublicVehicleQuery,
  ): Promise<PublicVehicleDetail> {
    return this.discovery.getPublicVehicle(idOrSlug, query);
  }
}

@ApiTags('public')
@Controller('places')
export class PlacesController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('suggest')
  @ApiOperation({
    summary: 'Town/area suggestions from the curated gazetteer (no external geocoder)',
  })
  @ApiZodResponse(200, z.array(PlaceSuggestionSchema))
  suggest(
    @Query(new ZodValidationPipe(PlaceSuggestQuerySchema)) query: PlaceSuggestQuery,
  ): Promise<PlaceSuggestion[]> {
    return this.discovery.suggestPlaces(query.q, query.limit);
  }
}
