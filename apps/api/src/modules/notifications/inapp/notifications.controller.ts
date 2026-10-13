import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MarkAllReadResponseSchema,
  NotificationListQuerySchema,
  NotificationListSchema,
  NotificationSchema,
  UnreadCountSchema,
  type MarkAllReadResponse,
  type Notification,
  type NotificationList,
  type NotificationListQuery,
  type UnreadCount,
} from '@vrp/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../../openapi/zod-openapi';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** The caller's own in-app feed; ids of other users' notifications are 404. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first (keyset pagination; ?unreadOnly=true)' })
  @ApiZodResponse(200, NotificationListSchema)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(NotificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<NotificationList> {
    return this.service.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications (indexed; safe to poll)' })
  @ApiZodResponse(200, UnreadCountSchema)
  async unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCount> {
    return this.service.unreadCount(user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all of my notifications read' })
  @ApiZodResponse(200, MarkAllReadResponseSchema)
  async readAll(@CurrentUser() user: AuthenticatedUser): Promise<MarkAllReadResponse> {
    return this.service.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification read (idempotent)' })
  @ApiZodResponse(200, NotificationSchema)
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<Notification> {
    return this.service.markRead(user.id, id);
  }
}
