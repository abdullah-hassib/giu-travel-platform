import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { AdministrationService } from './administration.service';
import { AccountsPageDto, AccountsQueryDto } from './dto/accounts-query.dto';
import { AccountIdParamDto, ResetPasswordDto } from './dto/reset-password.dto';
import { AccountStatusActionDto } from './dto/account-status.dto';

@ApiTags('Administration')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

  @Patch('accounts/:id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-15/ACC-16: suspend a traveler or moderator and persist the administrative event' })
  @ApiNoContentResponse({ description: 'Status, session revocation and pending event committed; delivery integration remains pending' })
  @ApiBadRequestResponse({ description: 'Invalid ObjectId or unsupported body fields' })
  @ApiUnauthorizedResponse({ description: 'Active administrator session required' })
  @ApiForbiddenResponse({ description: 'Administrator required; administrator targets excluded' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({ description: 'Self-deactivated account cannot use the suspension workflow' })
  async suspendAccount(@Body() _body: AccountStatusActionDto, @Req() request: AuthenticatedRequest, @Param() params: AccountIdParamDto): Promise<void> {
    await this.administration.changeAccountStatus(request.authUser.id, params.id, 'suspended');
  }

  @Patch('accounts/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-15/ACC-16: reactivate a suspended traveler or moderator and persist the administrative event' })
  @ApiNoContentResponse({ description: 'Status and pending event committed; old sessions remain invalid' })
  @ApiBadRequestResponse({ description: 'Invalid ObjectId or unsupported body fields' })
  @ApiUnauthorizedResponse({ description: 'Active administrator session required' })
  @ApiForbiddenResponse({ description: 'Administrator required; administrator targets excluded' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({ description: 'Self-deactivated account needs a separate recovery policy' })
  async reactivateAccount(@Body() _body: AccountStatusActionDto, @Req() request: AuthenticatedRequest, @Param() params: AccountIdParamDto): Promise<void> {
    await this.administration.changeAccountStatus(request.authUser.id, params.id, 'active');
  }

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
