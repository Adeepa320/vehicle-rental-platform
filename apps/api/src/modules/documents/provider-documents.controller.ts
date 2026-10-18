import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MAX_DOCUMENT_BYTES,
  ProviderDocumentListQuerySchema,
  ProviderDocumentListSchema,
  ProviderDocumentSchema,
  UploadDocumentFieldsSchema,
  type ProviderDocumentList,
  type ProviderDocumentListQuery,
  type UploadDocumentFields,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ApiException } from '../../common/errors/api.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta } from '../auth/auth.types';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { colomboDay } from './document.verification';
import { DocumentsService, type DocumentContent } from './documents.service';

const IdPipe = new ZodValidationPipe(z.uuid());

interface MultipartFile {
  buffer?: Buffer;
  size: number;
}

/** Streams a private file to an authorised caller; never cached, never inline-rendered HTML. */
export function sendDocument(response: Response, content: DocumentContent): void {
  response.setHeader('Content-Type', content.mimeType);
  response.setHeader('Content-Length', String(content.buffer.length));
  response.setHeader('Content-Disposition', `attachment; filename="${content.fileName}"`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(200).end(content.buffer);
}

/** The calling provider's own verification documents (Phase 9). */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/documents')
export class ProviderDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOperation({
    summary: 'My provider and vehicle documents (current uploads; history on request)',
  })
  @ApiZodResponse(200, ProviderDocumentListSchema)
  async list(
    @CurrentProvider() provider: ProviderProfile,
    @Query(new ZodValidationPipe(ProviderDocumentListQuerySchema)) query: ProviderDocumentListQuery,
  ): Promise<ProviderDocumentList> {
    return { data: await this.documents.listForProvider(provider.id, query) };
  }

  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      // One file plus the small metadata fields of UploadDocumentFieldsSchema (DoS guard, Phase 10).
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 8, parts: 9, fieldSize: 2048 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a verification document (PDF / JPEG / PNG ≤ 10 MB, validated by content); replaces the current one of the same type',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string' },
        vehicleId: { type: 'string', format: 'uuid' },
        documentNumber: { type: 'string' },
        issuedOn: { type: 'string', format: 'date' },
        expiresOn: { type: 'string', format: 'date' },
      },
    },
  })
  @ApiZodResponse(201, ProviderDocumentSchema)
  async upload(
    @CurrentProvider() provider: ProviderProfile,
    @Body(new ZodValidationPipe(UploadDocumentFieldsSchema)) fields: UploadDocumentFields,
    @UploadedFile() file: MultipartFile | undefined,
    @Req() request: Request,
  ) {
    if (!file || !file.buffer) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        { field: 'file', issue: 'attach one document as the "file" field' },
      ]);
    }
    const row = await this.documents.upload(
      provider,
      fields,
      { buffer: file.buffer, size: file.size },
      requestMeta(request),
    );
    return this.documents.providerView(row);
  }

  @Get(':id/content')
  @ApiOperation({ summary: 'Download one of my documents (streamed; never a shareable URL)' })
  async content(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    sendDocument(response, await this.documents.contentForProvider(provider.id, id));
  }
}

/** Exposed for the smoke test and docs: the calendar day the API treats as "today". */
export const documentsToday = colomboDay;
