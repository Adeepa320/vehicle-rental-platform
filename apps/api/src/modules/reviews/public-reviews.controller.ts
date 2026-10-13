import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PublicReviewListSchema,
  ReviewListQuerySchema,
  type PublicReviewList,
  type ReviewListQuery,
} from '@vrp/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Public } from '../auth/decorators/public.decorator';
import { ReviewsService } from './reviews.service';

const SlugOrIdPipe = new ZodValidationPipe(
  z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i),
);

/** Published reviews of a listed vehicle: customer-safe projection only. */
@ApiTags('reviews')
@Controller('vehicles/:idOrSlug/reviews')
export class PublicReviewsController {
  constructor(private readonly service: ReviewsService) {}

  // Public: listing pages are unauthenticated; the mapper exposes no customer or booking identifiers.
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Published reviews of a vehicle, newest first, with the rating aggregate',
  })
  @ApiZodResponse(200, PublicReviewListSchema)
  async list(
    @Param('idOrSlug', SlugOrIdPipe) idOrSlug: string,
    @Query(new ZodValidationPipe(ReviewListQuerySchema)) query: ReviewListQuery,
  ): Promise<PublicReviewList> {
    return this.service.listForVehicle(idOrSlug, query);
  }
}
