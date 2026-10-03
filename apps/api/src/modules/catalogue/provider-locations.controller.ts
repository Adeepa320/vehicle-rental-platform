import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateProviderLocationRequestSchema,
  ProviderLocationListSchema,
  ProviderLocationSchema,
  UpdateProviderLocationRequestSchema,
  type CreateProviderLocationRequest,
  type ProviderLocation,
  type UpdateProviderLocationRequest,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta } from '../auth/auth.types';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { ProviderLocationsService } from './provider-locations.service';
import { toProviderLocation } from './vehicle.mappers';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Pickup / operating locations of the calling (active) provider. */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/locations')
export class ProviderLocationsController {
  constructor(private readonly locations: ProviderLocationsService) {}

  @Get()
  @ApiOperation({ summary: 'My pickup locations (active first)' })
  @ApiZodResponse(200, ProviderLocationListSchema)
  async list(@CurrentProvider() provider: ProviderProfile): Promise<ProviderLocation[]> {
    const rows = await this.locations.list(provider.id);
    return rows.map((r) => toProviderLocation(r.location, r.vehicleCount));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a pickup location (the first one becomes primary)' })
  @ApiZodBody(CreateProviderLocationRequestSchema)
  @ApiZodResponse(201, ProviderLocationSchema)
  async create(
    @CurrentProvider() provider: ProviderProfile,
    @Body(new ZodValidationPipe(CreateProviderLocationRequestSchema))
    body: CreateProviderLocationRequest,
    @Req() request: Request,
  ): Promise<ProviderLocation> {
    const result = await this.locations.create(provider, body, requestMeta(request));
    return toProviderLocation(result.location, result.vehicleCount);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my pickup locations' })
  @ApiZodResponse(200, ProviderLocationSchema)
  async get(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
  ): Promise<ProviderLocation> {
    const result = await this.locations.getOwnedWithCount(provider.id, id);
    return toProviderLocation(result.location, result.vehicleCount);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a pickup location (set primary, reactivate, edit details)' })
  @ApiZodBody(UpdateProviderLocationRequestSchema)
  @ApiZodResponse(200, ProviderLocationSchema)
  async update(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(UpdateProviderLocationRequestSchema))
    body: UpdateProviderLocationRequest,
    @Req() request: Request,
  ): Promise<ProviderLocation> {
    const result = await this.locations.update(provider, id, body, requestMeta(request));
    return toProviderLocation(result.location, result.vehicleCount);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a pickup location (kept for history; refused while vehicles use it)',
  })
  async deactivate(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.locations.update(provider, id, { isActive: false }, requestMeta(request));
  }
}
