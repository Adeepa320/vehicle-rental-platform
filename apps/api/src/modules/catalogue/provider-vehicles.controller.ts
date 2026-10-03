import {
  Body,
  Controller,
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
  CreateVehicleRequestSchema,
  UpdateVehicleRequestSchema,
  VehicleListSchema,
  VehicleSchema,
  type CreateVehicleRequest,
  type UpdateVehicleRequest,
  type Vehicle,
  type VehicleSummary,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { AuthThrottle } from '../auth/auth-throttle';
import { requestMeta } from '../auth/auth.types';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { toVehicle, toVehicleSummary } from './vehicle.mappers';
import { VehiclesService } from './vehicles.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Vehicle listings of the calling (active) provider. */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/vehicles')
export class ProviderVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'My vehicles (newest first)' })
  @ApiZodResponse(200, VehicleListSchema)
  async list(@CurrentProvider() provider: ProviderProfile): Promise<VehicleSummary[]> {
    return (await this.vehicles.listMine(provider.id)).map(toVehicleSummary);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a draft listing (only the category is required)' })
  @ApiZodBody(CreateVehicleRequestSchema)
  @ApiZodResponse(201, VehicleSchema)
  async create(
    @CurrentProvider() provider: ProviderProfile,
    @Body(new ZodValidationPipe(CreateVehicleRequestSchema)) body: CreateVehicleRequest,
    @Req() request: Request,
  ): Promise<Vehicle> {
    return toVehicle(await this.vehicles.create(provider, body, requestMeta(request)));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my vehicles, with the submission checklist' })
  @ApiZodResponse(200, VehicleSchema)
  async get(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
  ): Promise<Vehicle> {
    return toVehicle(await this.vehicles.getOwned(provider.id, id));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a listing: all fields while draft / changes requested, operational fields once approved',
  })
  @ApiZodBody(UpdateVehicleRequestSchema)
  @ApiZodResponse(200, VehicleSchema)
  async update(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(UpdateVehicleRequestSchema)) body: UpdateVehicleRequest,
    @Req() request: Request,
  ): Promise<Vehicle> {
    return toVehicle(await this.vehicles.update(provider, id, body, requestMeta(request)));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @AuthThrottle('sensitive')
  @ApiOperation({ summary: 'Submit a complete listing for platform review' })
  @ApiZodResponse(200, VehicleSchema)
  async submit(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<Vehicle> {
    return toVehicle(await this.vehicles.submit(provider, id, requestMeta(request)));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take an approved listing offline (approved → inactive)' })
  @ApiZodResponse(200, VehicleSchema)
  async deactivate(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<Vehicle> {
    return toVehicle(await this.vehicles.deactivate(provider, id, requestMeta(request)));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Put an inactive listing back online (inactive → approved)' })
  @ApiZodResponse(200, VehicleSchema)
  async activate(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<Vehicle> {
    return toVehicle(await this.vehicles.activate(provider, id, requestMeta(request)));
  }
}
