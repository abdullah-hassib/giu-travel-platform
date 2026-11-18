import { BadRequestException, Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { SessionGuard } from '../auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { AuditLogsPageDto, AuditLogsQueryDto } from './dto/audit-logs.dto';
import { AuditLoggingService } from './audit-logging.service';

@ApiTags('Administration')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
@Controller('admin/audit-logs')
export class AuditLoggingController {
  constructor(private readonly auditLogging: AuditLoggingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-07: search and list administrative audit records' })
  @ApiOkResponse({ type: AuditLogsPageDto })
  @ApiBadRequestResponse({ description: 'Invalid filter, date range, pagination, or sort field' })
  @ApiUnauthorizedResponse({ description: 'Active session required' })
  @ApiForbiddenResponse({ description: 'Administrator role required' })
  list(@Query() query: AuditLogsQueryDto): Promise<AuditLogsPageDto> {
    if (query.sortBy && query.sortBy !== 'occurredAt') throw new BadRequestException('Unsupported sort field');
    return this.auditLogging.list(query);
  }
}
