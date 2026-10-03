import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType, z } from 'zod';

import { ApiException } from '../errors/api.exception';

/**
 * Validates a request body/query/param against a schema from `@vrp/contracts`
 * and returns the parsed (typed, defaulted) value.
 *
 * Usage: `@Body(new ZodValidationPipe(CreateThingSchema)) body: CreateThing`.
 * Per-route pipes are preferred over a global pipe so each handler's schema is
 * explicit and visible next to the route.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data as z.output<TSchema>;
    }
    const details = result.error.issues.map((issue) => ({
      ...(issue.path.length > 0 ? { field: issue.path.map(String).join('.') } : {}),
      issue: issue.message,
    }));
    throw new ApiException('VALIDATION_ERROR', `Invalid request ${metadata.type}`, 400, details);
  }
}
