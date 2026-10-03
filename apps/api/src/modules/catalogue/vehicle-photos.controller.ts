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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MAX_PHOTO_BYTES,
  ReorderVehiclePhotosRequestSchema,
  VehiclePhotoListSchema,
  VehiclePhotoSchema,
  type ReorderVehiclePhotosRequest,
  type VehiclePhoto,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request } from 'express';
import { z } from 'zod';

import { ApiException } from '../../common/errors/api.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta } from '../auth/auth.types';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { VehiclePhotosService } from './vehicle-photos.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** The parts of a multer memory-storage file the upload path uses. */
interface MultipartFile {
  buffer?: Buffer;
  size: number;
}

/** Listing photos of one of the calling provider's vehicles. */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/vehicles/:vehicleId/photos')
export class VehiclePhotosController {
  constructor(private readonly photos: VehiclePhotosService) {}

  @Get()
  @ApiOperation({ summary: 'Photos of the vehicle in display order (first = primary)' })
  @ApiZodResponse(200, VehiclePhotoListSchema)
  async list(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
  ): Promise<VehiclePhoto[]> {
    // Ownership is checked by the service through the vehicle lookup.
    await this.photos.assertOwned(provider.id, vehicleId);
    return this.photos.listViews(vehicleId);
  }

  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a photo (JPEG/PNG/WebP ≤ 10 MB); validated by content, re-encoded, metadata stripped',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiZodResponse(201, VehiclePhotoSchema)
  async upload(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @UploadedFile() file: MultipartFile | undefined,
    @Req() request: Request,
  ): Promise<VehiclePhoto> {
    if (!file || !file.buffer) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'file', issue: 'attach one image as the "file" field' },
      ]);
    }
    const row = await this.photos.upload(
      provider,
      vehicleId,
      { buffer: file.buffer, size: file.size },
      requestMeta(request),
    );
    return this.photos.toView(row);
  }

  @Patch('order')
  @ApiOperation({ summary: 'Reorder photos; the first id becomes the primary photo' })
  @ApiZodBody(ReorderVehiclePhotosRequestSchema)
  @ApiZodResponse(200, VehiclePhotoListSchema)
  async reorder(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @Body(new ZodValidationPipe(ReorderVehiclePhotosRequestSchema))
    body: ReorderVehiclePhotosRequest,
    @Req() request: Request,
  ): Promise<VehiclePhoto[]> {
    const rows = await this.photos.reorder(
      provider,
      vehicleId,
      body.photoIds,
      requestMeta(request),
    );
    return rows.map((row) => this.photos.toView(row));
  }

  @Delete(':photoId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a photo' })
  async remove(
    @CurrentProvider() provider: ProviderProfile,
    @Param('vehicleId', IdPipe) vehicleId: string,
    @Param('photoId', IdPipe) photoId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.photos.remove(provider, vehicleId, photoId, requestMeta(request));
  }
}
