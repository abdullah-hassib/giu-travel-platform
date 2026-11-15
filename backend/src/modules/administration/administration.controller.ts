import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { SessionGuard } from '../auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { AdministrationService } from './administration.service';
import { AccountsPageDto, AccountsQueryDto } from './dto/accounts-query.dto';

@ApiTags('Administration')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

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
