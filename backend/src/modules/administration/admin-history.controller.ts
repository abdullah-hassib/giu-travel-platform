import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import {
  AdminHistoryPageDto,
  AdminHistoryQueryDto,
} from './dto/admin-history.dto';
import { AdminHistoryService } from './admin-history.service';

@ApiTags('Administration')
@Controller('admin')
export class AdminHistoryController {
  constructor(private readonly history: AdminHistoryService) {}
  @Get('audit-logs')
  @Authenticated('admin')
  @ApiOperation({
    summary:
      'GEN-07: read retained committed administrative actions, ten per page',
    description:
      'Combines retained account/provider/moderation envelopes and durable audit copies, deduplicated by event ID, with actor/action/inclusive UTC-date filters. Ten per page, newest first. outcome=committed describes the action; deliveryStatus separately shows acknowledgment. No raw payload or metadata is exposed.',
  })
  @ApiOkResponse({ type: AdminHistoryPageDto })
  @ApiBadRequestResponse({
    description:
      'Invalid action/actor/date/page, reversed date range or unsupported fields',
  })
  list(@Query() query: AdminHistoryQueryDto): Promise<AdminHistoryPageDto> {
    return this.history.list(query);
  }
}
