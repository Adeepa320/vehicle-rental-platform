import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorSchema } from '@vrp/contracts';

import { APP_VERSION } from '../version';
import { zodToOpenApi } from './zod-openapi';

export const OPENAPI_UI_PATH = 'api/docs';
export const OPENAPI_JSON_PATH = 'api/docs-json';

/**
 * Serves Swagger UI and the OpenAPI document (non-production by default).
 * Schemas come from `@vrp/contracts` via `ApiZodBody` / `ApiZodResponse`, so
 * the document always matches what the validation pipes enforce.
 */
export function setupOpenApi(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('Vehicle Rental Platform API')
    .setDescription(
      'REST API for the Sri Lankan vehicle rental marketplace. Errors use the `ApiError` envelope.',
    )
    .setVersion(APP_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('system', 'Health and readiness')
    .addTag('auth', 'Registration, login, sessions, e-mail verification, password reset')
    .addTag('users', 'Current user profile');

  const document = SwaggerModule.createDocument(app, builder.build());
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ApiError: zodToOpenApi(ApiErrorSchema, 'output') as never,
  };

  SwaggerModule.setup(OPENAPI_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    useGlobalPrefix: false,
    swaggerOptions: { persistAuthorization: true },
  });
}
