import { Body, Controller, Get, HttpCode, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ProviderApplicationDraftSchema,
  ProviderApplicationSchema,
  ProviderProfileSchema,
  SubmitProviderApplicationRequestSchema,
  UpdateProviderProfileRequestSchema,
  type ProviderApplication,
  type ProviderApplicationDraft,
  type ProviderProfile,
  type SubmitProviderApplicationRequest,
  type UpdateProviderProfileRequest,
} from '@vrp/contracts';
import type { Request } from 'express';

import { ApiException } from '../../common/errors/api.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { AuthThrottle } from '../auth/auth-throttle';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActiveProviderGuard } from './guards/active-provider.guard';
import { ProviderApplicationsService } from './provider-applications.service';
import { toApplicantApplication, toProviderProfile } from './provider.mappers';
import { ProvidersService } from './providers.service';

/** The caller's own application and (once approved) provider profile. */
@ApiTags('providers')
@ApiBearerAuth()
@Controller('providers/me')
export class ProvidersController {
  constructor(
    private readonly applications: ProviderApplicationsService,
    private readonly providers: ProvidersService,
  ) {}

  // ---------------------------------------------------------- application

  @Get('application')
  @ApiOperation({ summary: 'My provider application' })
  @ApiZodResponse(200, ProviderApplicationSchema)
  async myApplication(@CurrentUser() user: AuthenticatedUser): Promise<ProviderApplication> {
    return toApplicantApplication(await this.applications.getMineOrThrow(user.id));
  }

  @Put('application')
  @ApiOperation({
    summary: 'Create or update my application while it is a draft or changes were requested',
  })
  @ApiZodBody(ProviderApplicationDraftSchema)
  @ApiZodResponse(200, ProviderApplicationSchema)
  async saveApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ProviderApplicationDraftSchema)) body: ProviderApplicationDraft,
  ): Promise<ProviderApplication> {
    return toApplicantApplication(await this.applications.upsertDraft(user.id, body));
  }

  @Post('application/submit')
  @HttpCode(200)
  @AuthThrottle('sensitive')
  @ApiOperation({ summary: 'Submit my application for platform review' })
  @ApiZodBody(SubmitProviderApplicationRequestSchema)
  @ApiZodResponse(200, ProviderApplicationSchema)
  async submitApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(SubmitProviderApplicationRequestSchema))
    _body: SubmitProviderApplicationRequest,
    @Req() request: Request,
  ): Promise<ProviderApplication> {
    return toApplicantApplication(await this.applications.submit(user.id, requestMeta(request)));
  }

  // -------------------------------------------------------------- profile

  @Get()
  @ApiOperation({ summary: 'My provider profile (approved providers, including suspended ones)' })
  @ApiZodResponse(200, ProviderProfileSchema)
  async myProfile(@CurrentUser() user: AuthenticatedUser): Promise<ProviderProfile> {
    const result = await this.providers.getMine(user.id);
    if (!result) throw new ApiException('NOT_FOUND', 'You are not an approved provider yet', 404);
    return toProviderProfile(result.profile, result.relations);
  }

  @Patch()
  @UseGuards(ActiveProviderGuard)
  @ApiOperation({ summary: 'Update contact/description fields (active providers only)' })
  @ApiZodBody(UpdateProviderProfileRequestSchema)
  @ApiZodResponse(200, ProviderProfileSchema)
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProviderProfileRequestSchema))
    body: UpdateProviderProfileRequest,
    @Req() request: Request,
  ): Promise<ProviderProfile> {
    const result = await this.providers.updateMine(user.id, body, requestMeta(request));
    return toProviderProfile(result.profile, result.relations);
  }
}
