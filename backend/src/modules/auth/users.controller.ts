import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, SessionGuard } from './security/session.guard';
import { SESSION_COOKIE_NAME } from './security/session-cookie';

@ApiTags('Users')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly auth: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  getOwnProfile(@Req() request: AuthenticatedRequest) {
    return request.authUser;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Edit own basic profile' })
  updateOwnProfile(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(request.authUser.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate own account and revoke all sessions' })
  async deactivate(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.users.deactivate(request.authUser.id);
    await this.auth.revokeAllSessions(request.authUser.id);
    response.clearCookie(SESSION_COOKIE_NAME, { path: '/api' });
  }
}
