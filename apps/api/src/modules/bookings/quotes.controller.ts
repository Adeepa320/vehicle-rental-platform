import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BookingQuoteQuerySchema,
  BookingQuoteSchema,
  type BookingQuote,
  type BookingQuoteQuery,
} from '@vrp/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Public } from '../auth/decorators/public.decorator';
import { BookingsService } from './bookings.service';

const IdOrSlugPipe = new ZodValidationPipe(z.string().min(1).max(80));

/** Public price quote: anyone can see the price; a signed token is needed to book. */
@ApiTags('public')
@Controller('vehicles')
export class QuotesController {
  constructor(private readonly service: BookingsService) {}

  // Public: the price is public information (same rates as the listing page) and the token carries no identity.
  @Public()
  @Get(':idOrSlug/quote')
  @ApiOperation({
    summary:
      'Price for a period plus a signed quote token (valid 15 minutes) when the vehicle is bookable',
  })
  @ApiZodResponse(200, BookingQuoteSchema)
  async quote(
    @Param('idOrSlug', IdOrSlugPipe) idOrSlug: string,
    @Query(new ZodValidationPipe(BookingQuoteQuerySchema)) query: BookingQuoteQuery,
  ): Promise<BookingQuote> {
    return this.service.quote(idOrSlug, query);
  }
}
