import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChangePasswordRequestSchema, type ChangePasswordRequest } from '@vrp/contracts';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env.schema';
import { ApiZodBody } from '../../openapi/zod-openapi';
import { clearRefreshCookie } from './auth-cookies';
import { AuthThrottle } from './auth-throttle';
import { AuthService } from './auth.service';
import { requestMeta, type AuthenticatedUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';

/**
 * `POST /users/me/password` (Phase 10, ASVS V6.2.3). Lives in the auth module
 * because it needs the password, refresh-token and audit services; the users
 * module stays free of authentication logic. Not `@MfaExempt()`: a privileged
 * account must have completed MFA in this session to change its password.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class AccountPasswordController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @AuthThrottle('login')
  @Post('me/password')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Change the password of the signed-in account; signs out every session, including this one',
  })
  @ApiZodBody(ChangePasswordRequestSchema)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(user, body, requestMeta(request));
    // The refresh cookie's session is revoked; drop it so the browser stops sending it.
    clearRefreshCookie(response, this.config);
  }
}
