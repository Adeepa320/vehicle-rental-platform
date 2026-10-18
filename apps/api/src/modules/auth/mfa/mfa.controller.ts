import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthSessionResponseSchema,
  MfaChallengeRequestSchema,
  MfaEnrolConfirmRequestSchema,
  MfaEnrolConfirmResponseSchema,
  MfaEnrolStartRequestSchema,
  MfaEnrolStartResponseSchema,
  MfaRecoveryCodesSchema,
  MfaRecoveryRequestSchema,
  MfaStatusSchema,
  MfaStepUpRequestSchema,
  type AuthSessionResponse,
  type MfaChallengeRequest,
  type MfaEnrolConfirmRequest,
  type MfaEnrolConfirmResponse,
  type MfaEnrolStartRequest,
  type MfaEnrolStartResponse,
  type MfaRecoveryCodes,
  type MfaRecoveryRequest,
  type MfaStatus,
  type MfaStepUpRequest,
} from '@vrp/contracts';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { Env } from '../../../config/env.schema';
import { ApiZodBody, ApiZodResponse } from '../../../openapi/zod-openapi';
import { setRefreshCookie } from '../auth-cookies';
import { AuthThrottle } from '../auth-throttle';
import { AuthService, type SessionResult } from '../auth.service';
import { requestMeta, type AuthenticatedUser } from '../auth.types';
import { CurrentUser } from '../decorators/current-user.decorator';
import { MfaExempt } from '../decorators/mfa-exempt.decorator';
import { Public } from '../decorators/public.decorator';
import { MfaService } from './mfa.service';

/**
 * Authenticator-app second factor (Phase 10). Enrolment and management need a
 * logged-in administrator; `challenge` and `recovery` are the second half of a
 * login and are public, rate-limited like the login route, and bound to the
 * signed challenge the login answered with.
 */
@ApiTags('auth')
@MfaExempt()
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Two-factor status of the current account and session' })
  @ApiZodResponse(200, MfaStatusSchema)
  status(@CurrentUser() user: AuthenticatedUser): Promise<MfaStatus> {
    return this.mfa.status(user);
  }

  @Post('enrol/start')
  @HttpCode(200)
  @AuthThrottle('sensitive')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Start enrolling an authenticator app (administrators; password required)',
  })
  @ApiZodBody(MfaEnrolStartRequestSchema)
  @ApiZodResponse(200, MfaEnrolStartResponseSchema)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(MfaEnrolStartRequestSchema)) body: MfaEnrolStartRequest,
    @Req() request: Request,
  ): Promise<MfaEnrolStartResponse> {
    return this.mfa.startEnrolment(user, body, requestMeta(request));
  }

  @Post('enrol/confirm')
  @HttpCode(200)
  @AuthThrottle('login')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Confirm the enrolment with a code; returns the recovery codes once and upgrades the session',
  })
  @ApiZodBody(MfaEnrolConfirmRequestSchema)
  @ApiZodResponse(200, MfaEnrolConfirmResponseSchema)
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(MfaEnrolConfirmRequestSchema)) body: MfaEnrolConfirmRequest,
    @Req() request: Request,
  ): Promise<MfaEnrolConfirmResponse> {
    return this.mfa.confirmEnrolment(user, body, requestMeta(request));
  }

  @Public()
  @AuthThrottle('login')
  @Post('challenge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish a login with the authenticator code' })
  @ApiZodBody(MfaChallengeRequestSchema)
  @ApiZodResponse(200, AuthSessionResponseSchema)
  async challenge(
    @Body(new ZodValidationPipe(MfaChallengeRequestSchema)) body: MfaChallengeRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.completeMfaChallenge(
      { challengeToken: body.challengeToken, code: body.code },
      requestMeta(request),
    );
    return this.respond(response, result);
  }

  @Public()
  @AuthThrottle('login')
  @Post('recovery')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish a login with a one-time recovery code' })
  @ApiZodBody(MfaRecoveryRequestSchema)
  @ApiZodResponse(200, AuthSessionResponseSchema)
  async recovery(
    @Body(new ZodValidationPipe(MfaRecoveryRequestSchema)) body: MfaRecoveryRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.completeMfaChallenge(
      { challengeToken: body.challengeToken, recoveryCode: body.recoveryCode },
      requestMeta(request),
    );
    return this.respond(response, result);
  }

  @Post('disable')
  @HttpCode(204)
  @AuthThrottle('sensitive')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove the authenticator (password and a current code required)' })
  @ApiZodBody(MfaStepUpRequestSchema)
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(MfaStepUpRequestSchema)) body: MfaStepUpRequest,
    @Req() request: Request,
  ): Promise<void> {
    await this.mfa.disable(user, body, requestMeta(request));
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @AuthThrottle('sensitive')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Generate a new set of recovery codes (password and a current code required); the old set stops working',
  })
  @ApiZodBody(MfaStepUpRequestSchema)
  @ApiZodResponse(200, MfaRecoveryCodesSchema)
  regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(MfaStepUpRequestSchema)) body: MfaStepUpRequest,
    @Req() request: Request,
  ): Promise<MfaRecoveryCodes> {
    return this.mfa.regenerateRecoveryCodes(user, body, requestMeta(request));
  }

  private respond(response: Response, result: SessionResult): AuthSessionResponse {
    if (result.client === 'web') {
      setRefreshCookie(
        response,
        this.config,
        result.refreshToken.raw,
        result.refreshToken.expiresAt,
      );
    }
    return result.session;
  }
}
