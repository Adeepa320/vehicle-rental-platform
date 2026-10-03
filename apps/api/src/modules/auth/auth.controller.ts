import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthSessionResponseSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  MessageResponseSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  ResendVerificationRequestSchema,
  ResetPasswordRequestSchema,
  VerifyEmailRequestSchema,
  VerifyEmailResponseSchema,
  type AuthSessionResponse,
  type ForgotPasswordRequest,
  type LoginRequest,
  type MessageResponse,
  type RefreshRequest,
  type RegisterRequest,
  type RegisterResponse,
  type ResendVerificationRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
} from '@vrp/contracts';
import type { Request, Response } from 'express';

import { ApiException } from '../../common/errors/api.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env.schema';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './auth-cookies';
import { AuthThrottle } from './auth-throttle';
import { AuthService, type SessionResult } from './auth.service';
import { requestMeta, type AuthenticatedUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { OriginGuard } from './guards/origin.guard';

const VERIFICATION_SENT = 'If an account exists for this email, a verification link has been sent.';
const RESET_SENT = 'If an account exists for this email, a password reset link has been sent.';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @AuthThrottle('sensitive')
  @Post('register')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a customer account (e-mail verification required before login)',
  })
  @ApiZodBody(RegisterRequestSchema)
  @ApiZodResponse(201, RegisterResponseSchema)
  register(
    @Body(new ZodValidationPipe(RegisterRequestSchema)) body: RegisterRequest,
    @Req() request: Request,
  ): Promise<RegisterResponse> {
    return this.auth.register(body, requestMeta(request));
  }

  @Public()
  @AuthThrottle('login')
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with e-mail and password' })
  @ApiZodBody(LoginRequestSchema)
  @ApiZodResponse(200, AuthSessionResponseSchema)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    return this.respondWithSession(response, await this.auth.login(body, requestMeta(request)));
  }

  @Public()
  @UseGuards(OriginGuard)
  @AuthThrottle('refresh')
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Rotate the refresh token (cookie for web, body for mobile) and get a new access token',
  })
  @ApiZodBody(RefreshRequestSchema)
  @ApiZodResponse(200, AuthSessionResponseSchema)
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: RefreshRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const raw = body.refreshToken ?? readRefreshCookie(request);
    if (!raw) {
      throw new ApiException('REFRESH_INVALID', 'Refresh token is missing', 401);
    }
    try {
      return this.respondWithSession(response, await this.auth.refresh(raw, requestMeta(request)));
    } catch (error) {
      // A dead cookie would otherwise be re-sent on every attempt.
      clearRefreshCookie(response, this.config);
      throw error;
    }
  }

  @Public()
  @UseGuards(OriginGuard)
  @AuthThrottle('refresh')
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session (refresh token) and clear the cookie' })
  @ApiZodBody(RefreshRequestSchema)
  async logout(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: RefreshRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken ?? readRefreshCookie(request));
    clearRefreshCookie(response, this.config);
  }

  @UseGuards(OriginGuard)
  @Post('logout-all')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.id);
    clearRefreshCookie(response, this.config);
  }

  @Public()
  @AuthThrottle('tokenUse')
  @Post('email/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an e-mail address with the token from the verification link' })
  @ApiZodBody(VerifyEmailRequestSchema)
  @ApiZodResponse(200, VerifyEmailResponseSchema)
  verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailRequestSchema)) body: VerifyEmailRequest,
  ): Promise<VerifyEmailResponse> {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @AuthThrottle('sensitive')
  @Post('email/resend-verification')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a new verification link (always 202)' })
  @ApiZodBody(ResendVerificationRequestSchema)
  @ApiZodResponse(202, MessageResponseSchema)
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationRequestSchema)) body: ResendVerificationRequest,
    @Req() request: Request,
  ): Promise<MessageResponse> {
    await this.auth.resendVerification(body.email, requestMeta(request));
    return { message: VERIFICATION_SENT };
  }

  @Public()
  @AuthThrottle('sensitive')
  @Post('password/forgot')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a password reset link (always 202)' })
  @ApiZodBody(ForgotPasswordRequestSchema)
  @ApiZodResponse(202, MessageResponseSchema)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordRequestSchema)) body: ForgotPasswordRequest,
    @Req() request: Request,
  ): Promise<MessageResponse> {
    await this.auth.forgotPassword(body.email, requestMeta(request));
    return { message: RESET_SENT };
  }

  @Public()
  @AuthThrottle('tokenUse')
  @Post('password/reset')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a new password with the token from the reset link; signs out all sessions',
  })
  @ApiZodBody(ResetPasswordRequestSchema)
  @ApiZodResponse(200, MessageResponseSchema)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordRequestSchema)) body: ResetPasswordRequest,
  ): Promise<MessageResponse> {
    await this.auth.resetPassword(body.token, body.newPassword);
    return { message: 'Your password has been updated. Please sign in with your new password.' };
  }

  private respondWithSession(response: Response, result: SessionResult): AuthSessionResponse {
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

function readRefreshCookie(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
