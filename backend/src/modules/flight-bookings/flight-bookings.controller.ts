import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SessionGuard, AuthenticatedRequest } from '../auth/security/session.guard';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';

@ApiTags('Flight Bookings')
@ApiCookieAuth('giu_session')
@Controller('flight-bookings')
@UseGuards(SessionGuard)
export class FlightBookingsController {
  constructor(
    private readonly flightBookingsService: FlightBookingsService,
  ) {}

  @Post('hold')
  @ApiOperation({
    summary: 'Reserve seats for 10 minutes and create a pending booking',
  })
  holdBooking(
    @Body() dto: HoldFlightBookingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.flightBookingsService.holdBooking(
      dto,
      request.authUser.id,
    );
  }
}
