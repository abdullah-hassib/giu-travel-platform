import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Patch, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { AuthService } from './auth.service';
import { AuthUserDto } from './dto/auth.dto';
import { AuthenticatedRequest, SessionGuard } from './security/session.guard';
import { clearAuthenticationCookies, SESSION_COOKIE_NAME } from './security/session-cookie';

@ApiTags('Users')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard)
@ApiUnauthorizedResponse({ description: 'Missing, expired or inactive account session' })
@ApiForbiddenResponse({ description: 'A mandatory password change must be completed first' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly auth: AuthService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AuthUserDto })
  @ApiOperation({ summary: 'Get own profile' })
  getOwnProfile(@Req() request: AuthenticatedRequest) {
    return request.authUser;
  }

  @Patch('me')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AuthUserDto })
  @ApiBadRequestResponse({ description: 'Invalid name, international phone, supported currency or unknown field. No profile fields are saved.' })
  @ApiNotFoundResponse({ description: 'The account became inactive or was removed before saving' })
  @ApiOperation({ summary: 'ACC-09: edit own name, phone and preferred currency' })
  updateOwnProfile(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(request.authUser.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate own account and revoke all sessions' })
  async deactivate(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.users.deactivate(request.authUser.id);
    await this.auth.revokeAllSessions(request.authUser.id);
    clearAuthenticationCookies(response);
  }
}
