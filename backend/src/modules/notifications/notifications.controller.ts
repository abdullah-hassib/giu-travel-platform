import { Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { AuthenticatedRequest, SessionGuard } from '../auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { NotificationsService } from './notifications.service';
import { NotificationDto, NotificationListQueryDto, NotificationPageDto, UnreadCountDto } from './dto/notifications.dto';

class NotificationIdParamDto {
  @IsMongoId()
  id!: string;
}

@ApiTags('Notifications')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-01: return the authenticated user’s unread notification count' })
  @ApiOkResponse({ type: UnreadCountDto })
  @ApiUnauthorizedResponse({ description: 'Active session required' })
  async unreadCount(@Req() request: AuthenticatedRequest): Promise<UnreadCountDto> {
    return { count: await this.notifications.unreadCount(request.authUser.id) };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-01: list the authenticated user’s notifications' })
  @ApiOkResponse({ type: NotificationPageDto })
  @ApiBadRequestResponse({ description: 'Invalid pagination or query' })
  @ApiUnauthorizedResponse({ description: 'Active session required' })
  list(@Req() request: AuthenticatedRequest, @Query() query: NotificationListQueryDto): Promise<NotificationPageDto> {
    return this.notifications.listForUser(request.authUser.id, query);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-01: mark one of the authenticated user’s notifications as read' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiBadRequestResponse({ description: 'Invalid notification ID' })
  @ApiNotFoundResponse({ description: 'Notification does not exist or is not owned by the authenticated user' })
  @ApiUnauthorizedResponse({ description: 'Active session required' })
  markAsRead(@Req() request: AuthenticatedRequest, @Param() params: NotificationIdParamDto): Promise<NotificationDto> {
    return this.notifications.markAsRead(request.authUser.id, params.id);
  }
}
