import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { AdministrationService } from './administration.service';
import { AccountsPageDto, AccountsQueryDto } from './dto/accounts-query.dto';
import { AccountIdParamDto, ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Administration')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-07a: set a temporary password; require password change and revoke all sessions' })
  @ApiNoContentResponse({ description: 'Reset and administrative outbox event committed atomically' })
  @ApiBadRequestResponse({ description: 'Invalid ObjectId or password' })
  @ApiForbiddenResponse({ description: 'Administrator required; administrator targets excluded' })
  @ApiNotFoundResponse({ description: 'Target account does not exist' })
  @ApiUnauthorizedResponse({ description: 'Active administrator session required' })
  async resetPassword(@Req() request: AuthenticatedRequest, @Param() params: AccountIdParamDto, @Body() dto: ResetPasswordDto): Promise<void> {
    await this.administration.resetPassword(request.authUser.id, params.id, dto.password);
  }

  @Get('accounts')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-14 / GEN-05: search and filter accounts, ten per page, newest first' })
  @ApiOkResponse({ type: AccountsPageDto })
  @ApiBadRequestResponse({ description: 'Invalid page/filter or unsupported query field' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or invalid session' })
  @ApiForbiddenResponse({ description: 'Administrator role required' })
  listAccounts(@Query() query: AccountsQueryDto): Promise<AccountsPageDto> {
    return this.administration.listAccounts(query);
  }
}
