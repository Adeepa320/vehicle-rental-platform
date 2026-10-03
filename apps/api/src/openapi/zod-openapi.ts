import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

type SchemaObject = Record<string, unknown>;

/**
 * Converts a contract schema to an OpenAPI 3.0 schema object using Zod's
 * built-in JSON Schema export. `io: 'input'` describes what clients send
 * (before transforms); `io: 'output'` what the API returns.
 */
export function zodToOpenApi(schema: ZodType, io: 'input' | 'output'): SchemaObject {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' });
  // OpenAPI 3.0 schema objects must not carry the JSON Schema dialect marker.
  const { $schema: _dialect, ...rest } = json as SchemaObject & { $schema?: string };
  return rest;
}

/** Documents the request body of a route from its contract schema. */
export const ApiZodBody = (schema: ZodType) =>
  applyDecorators(ApiBody({ schema: zodToOpenApi(schema, 'input') }));

/** Documents a response of a route from its contract schema. */
export const ApiZodResponse = (status: number, schema: ZodType, description?: string) =>
  applyDecorators(
    ApiResponse({
      status,
      ...(description ? { description } : {}),
      schema: zodToOpenApi(schema, 'output'),
    }),
  );
