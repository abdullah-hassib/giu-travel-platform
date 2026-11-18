import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AuthUserDto } from './dto/auth.dto';
import { AuthenticatedRequest, SessionGuard } from './security/session.guard';
import {
  clearAuthenticationCookies,
  SESSION_COOKIE_NAME,
} from './security/session-cookie';

@ApiTags('Users')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing, expired or inactive account session',
})
@ApiForbiddenResponse({
  description: 'A mandatory password change must be completed first',
})
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}

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
  @ApiBadRequestResponse({
    description:
      'Invalid name, international phone, supported currency or unknown field. No profile fields are saved.',
  })
  @ApiNotFoundResponse({
    description: 'The account became inactive or was removed before saving',
  })
  @ApiOperation({
    summary: 'ACC-09: edit own name, phone and preferred currency',
  })
  updateOwnProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(request.authUser.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ACC-12: deactivate own account unless upcoming Confirmed hotel bookings exist',
    description:
      'Status change, session-version invalidation and session deletion commit atomically. Hotel booking checks are integrated; flight checks require the compatible flight module. In-flight verified payment cannot confirm a closed account and reconciles through the existing hold-expiry/refund path.',
  })
  @ApiNoContentResponse({
    description:
      'Account deactivated, sessions revoked and authentication cookies cleared',
  })
  @ApiConflictResponse({
    description:
      'Upcoming Confirmed booking prevents deactivation; account and sessions are preserved',
  })
  async deactivate(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.lifecycle.deactivate(request.authUser.id);
    clearAuthenticationCookies(response);
  }
}
