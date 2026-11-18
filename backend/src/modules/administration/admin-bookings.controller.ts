import {
  Controller,
  Get,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import {
  AdminBookingsPageDto,
  AdminBookingsQueryDto,
} from './dto/admin-bookings.dto';
import { HotelAdminBookingsService } from './hotel-admin-bookings.service';

@ApiTags('Administration')
@Controller('admin')
export class AdminBookingsController {
  constructor(private readonly hotels: HotelAdminBookingsService) {}
  @Get('bookings')
  @Authenticated('admin')
  @ApiOperation({
    summary:
      'ACC-17: read hotel bookings with type=hotel, status and start-date filters',
    description:
      'Ten per page, newest created first with ID tie-breaker. Effective expiry/completion is calculated without writing booking state. Flight and combined results are unavailable until Adham supplies the flight integration; omitted type or type=flight returns 503 rather than a misleading partial list.',
  })
  @ApiOkResponse({ type: AdminBookingsPageDto })
  @ApiBadRequestResponse({
    description:
      'Invalid page/type/status/date, reversed range or unknown fields',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Flight/combined booking integration unavailable; use type=hotel for the available hotel list',
  })
  list(@Query() query: AdminBookingsQueryDto): Promise<AdminBookingsPageDto> {
    if (query.type !== 'hotel')
      throw new ServiceUnavailableException(
        'Flight and combined booking lists are unavailable; use type=hotel for hotel bookings',
      );
    return this.hotels.list(query);
  }
}
