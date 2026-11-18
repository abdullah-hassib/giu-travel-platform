import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import {
  AdminBookingsPageDto,
  AdminBookingsQueryDto,
} from './dto/admin-bookings.dto';
import { AdminBookingsService } from './admin-bookings.service';

@ApiTags('Administration')
@Controller('admin')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}
  @Get('bookings')
  @Authenticated('admin')
  @ApiOperation({
    summary:
      'ACC-17: read hotel, flight or globally combined bookings with status and start-date filters',
    description:
      'Omitted type combines both domains before one global sort/page/count. Ten per page, newest created first with type/ID tie-breakers. Expiry/completion is calculated read-only. Inclusive date filters use hotel check-in or outbound flight departure local date; flight date-to is final arrival UTC calendar date. Only identifiers, names, dates, amount/currency, reference and status are returned.',
  })
  @ApiOkResponse({ type: AdminBookingsPageDto })
  @ApiBadRequestResponse({
    description:
      'Invalid page/type/status/date, reversed range or unknown fields',
  })
  list(@Query() query: AdminBookingsQueryDto): Promise<AdminBookingsPageDto> {
    return this.bookings.list(query);
  }
}
