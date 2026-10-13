import {
  Body,
  Controller,
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
  ProviderReviewListSchema,
  ProviderReviewSchema,
  ReplyReviewRequestSchema,
  ReviewListQuerySchema,
  type ProviderReview,
  type ProviderReviewList,
  type ReplyReviewRequest,
  type ReviewListQuery,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta } from '../auth/auth.types';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { ReviewsService } from './reviews.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Reviews of the caller's own vehicles (another provider's review is 404). */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/reviews')
export class ProviderReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Reviews of my vehicles, newest first (hidden ones are marked)' })
  @ApiZodResponse(200, ProviderReviewListSchema)
  async list(
    @CurrentProvider() provider: ProviderProfile,
    @Query(new ZodValidationPipe(ReviewListQuerySchema)) query: ReviewListQuery,
  ): Promise<ProviderReviewList> {
    return this.service.listForProvider(provider.id, query);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reply once to a published review of my vehicle',
    description: 'Errors: 409 INVALID_STATE_TRANSITION (hidden review), 409 ALREADY_REPLIED.',
  })
  @ApiZodBody(ReplyReviewRequestSchema)
  @ApiZodResponse(200, ProviderReviewSchema)
  async reply(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ReplyReviewRequestSchema)) body: ReplyReviewRequest,
    @Req() request: Request,
  ): Promise<ProviderReview> {
    return this.service.reply(provider, id, body, requestMeta(request));
  }
}
