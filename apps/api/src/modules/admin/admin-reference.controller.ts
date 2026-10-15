import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminDistrictSchema,
  AdminPlaceListQuerySchema,
  AdminPlaceSchema,
  AdminVehicleCategorySchema,
  CreatePlaceRequestSchema,
  SlugIdSchema,
  UpdateDistrictRequestSchema,
  UpdatePlaceRequestSchema,
  UpdateVehicleCategoryRequestSchema,
  type AdminDistrict,
  type AdminPlace,
  type AdminPlaceListQuery,
  type AdminVehicleCategory,
  type CreatePlaceRequest,
  type UpdateDistrictRequest,
  type UpdatePlaceRequest,
  type UpdateVehicleCategoryRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminReferenceService } from './admin-reference.service';

const IdPipe = new ZodValidationPipe(z.uuid());
const SlugPipe = new ZodValidationPipe(SlugIdSchema);

/** Districts, places and categories (Phase 9): admins read, super admins change; nothing is deleted. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminReferenceController {
  constructor(private readonly service: AdminReferenceService) {}

  @Get('districts')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'All districts with place and provider counts' })
  @ApiZodResponse(200, z.array(AdminDistrictSchema))
  districts(): Promise<AdminDistrict[]> {
    return this.service.listDistricts();
  }

  @Patch('districts/:id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Edit a district’s display data or activate / deactivate it (audited)' })
  @ApiZodBody(UpdateDistrictRequestSchema)
  @ApiZodResponse(200, AdminDistrictSchema)
  updateDistrict(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', SlugPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDistrictRequestSchema)) body: UpdateDistrictRequest,
    @Req() request: Request,
  ): Promise<AdminDistrict> {
    return this.service.updateDistrict(admin, id, body, requestMeta(request));
  }

  @Get('places')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Places (active by default) with their provider-location counts' })
  @ApiZodResponse(200, z.array(AdminPlaceSchema))
  places(
    @Query(new ZodValidationPipe(AdminPlaceListQuerySchema)) query: AdminPlaceListQuery,
  ): Promise<AdminPlace[]> {
    return this.service.listPlaces(query);
  }

  @Post('places')
  @HttpCode(201)
  @Roles('super_admin')
  @ApiOperation({
    summary: 'Create a gazetteer place (validated district, parent and coordinates; audited)',
  })
  @ApiZodBody(CreatePlaceRequestSchema)
  @ApiZodResponse(201, AdminPlaceSchema)
  createPlace(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreatePlaceRequestSchema)) body: CreatePlaceRequest,
    @Req() request: Request,
  ): Promise<AdminPlace> {
    return this.service.createPlace(admin, body, requestMeta(request));
  }

  @Patch('places/:id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Edit or activate / deactivate a place (audited; never deleted)' })
  @ApiZodBody(UpdatePlaceRequestSchema)
  @ApiZodResponse(200, AdminPlaceSchema)
  updatePlace(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePlaceRequestSchema)) body: UpdatePlaceRequest,
    @Req() request: Request,
  ): Promise<AdminPlace> {
    return this.service.updatePlace(admin, id, body, requestMeta(request));
  }

  @Get('vehicle-categories')
  @Roles('admin', 'super_admin')
  @ApiOperation({
    summary: 'All categories incl. inactive ones, with listing counts and protection notes',
  })
  @ApiZodResponse(200, z.array(AdminVehicleCategorySchema))
  categories(): Promise<AdminVehicleCategory[]> {
    return this.service.listCategories();
  }

  @Patch('vehicle-categories/:id')
  @Roles('super_admin')
  @ApiOperation({
    summary:
      'Edit a category’s display data or operational flag (audited); scooter and tuk-tuk cannot be activated here',
  })
  @ApiZodBody(UpdateVehicleCategoryRequestSchema)
  @ApiZodResponse(200, AdminVehicleCategorySchema)
  updateCategory(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', SlugPipe) id: string,
    @Body(new ZodValidationPipe(UpdateVehicleCategoryRequestSchema))
    body: UpdateVehicleCategoryRequest,
    @Req() request: Request,
  ): Promise<AdminVehicleCategory> {
    return this.service.updateCategory(admin, id, body, requestMeta(request));
  }
}
