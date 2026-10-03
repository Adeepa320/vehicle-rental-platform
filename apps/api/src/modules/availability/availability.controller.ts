import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AvailabilityRangeQuerySchema,
  CreateAvailabilityBlockRequestSchema,
  HoldListQuerySchema,
  VehicleAvailabilitySchema,
  VehicleHoldListSchema,
  VehicleHoldSchema,
  type AvailabilityRangeQuery,
  type CreateAvailabilityBlockRequest,
  type HoldListQuery,
  type VehicleAvailability,
  type VehicleHold,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta } from '../auth/auth.types';
import { toHold } from '../catalogue/vehicle.mappers';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { AvailabilityService } from './availability.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Provider-managed availability of one of their vehicles. */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/vehicles/:vehicleId')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  @Get('availability')
  @ApiOperation({ summary: 'Is the vehicle available in a window, and which holds overlap it?' })
  @ApiZodResponse(200, VehicleAvailabilitySchema)
  async availability(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @Query(new ZodValidationPipe(AvailabilityRangeQuerySchema)) query: AvailabilityRangeQuery,
  ): Promise<VehicleAvailability> {
    return this.service.availability(provider.id, vehicleId, query);
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Manual blocks (current and upcoming by default)' })
  @ApiZodResponse(200, VehicleHoldListSchema)
  async listBlocks(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @Query(new ZodValidationPipe(HoldListQuerySchema)) query: HoldListQuery,
  ): Promise<VehicleHold[]> {
    return (await this.service.listHolds(provider.id, vehicleId, query)).map(toHold);
  }

  @Post('blocks')
  @HttpCode(201)
  @ApiOperation({ summary: 'Block a period (approved or inactive vehicles; overlaps are refused)' })
  @ApiZodBody(CreateAvailabilityBlockRequestSchema)
  @ApiZodResponse(201, VehicleHoldSchema)
  async createBlock(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @Body(new ZodValidationPipe(CreateAvailabilityBlockRequestSchema))
    body: CreateAvailabilityBlockRequest,
    @Req() request: Request,
  ): Promise<VehicleHold> {
    return toHold(await this.service.createBlock(provider, vehicleId, body, requestMeta(request)));
  }

  @Delete('blocks/:blockId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove one of my manual blocks' })
  async deleteBlock(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @Param('blockId', IdPipe) blockId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.deleteBlock(provider, vehicleId, blockId, requestMeta(request));
  }
}
