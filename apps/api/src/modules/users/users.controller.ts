import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  UpdateProfileRequestSchema,
  UserSchema,
  type UpdateProfileRequest,
  type User,
} from '@vrp/contracts';

import { ApiException } from '../../common/errors/api.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { toPublicUser } from './user.mapper';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  @ApiZodResponse(200, UserSchema)
  async me(@CurrentUser() current: AuthenticatedUser): Promise<User> {
    const user = await this.users.findById(current.id);
    if (!user) throw new ApiException('UNAUTHENTICATED', 'Authentication required', 401);
    return toPublicUser(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update basic profile fields' })
  @ApiZodBody(UpdateProfileRequestSchema)
  @ApiZodResponse(200, UserSchema)
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<User> {
    return toPublicUser(await this.users.updateProfile(current.id, body));
  }
}
