import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { AuthenticatedRequest } from '../auth/security/session.guard';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AccountsQueryDto } from '../administration/dto/accounts-query.dto';
import { PickType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';
import { AccountStatusActionDto } from '../administration/dto/account-status.dto';
import {
  FlightBookingViewDto,
  FlightBookingsPageDto,
  FlightHoldViewDto,
  FlightSummaryViewDto,
} from './dto/flight-booking-view.dto';

export class FlightBookingQueryDto extends PickType(AccountsQueryDto, [
  'page',
] as const) {
  @ApiPropertyOptional({ enum: ['Upcoming', 'Past', 'Cancelled'] })
  @IsOptional()
  @IsIn(['Upcoming', 'Past', 'Cancelled'])
  group?: 'Upcoming' | 'Past' | 'Cancelled';
}

@ApiTags('Flight Bookings')
@ApiCookieAuth('giu_session')
@Controller('flight-bookings')
@ApiBadRequestResponse({
  description: 'Invalid flight/cabin/passengers, baggage or query',
})
@ApiConflictResponse({
  description:
    'Inactive/departed flight, unavailable inventory or incompatible booking state',
})
@ApiNotFoundResponse({
  description: 'Flight/provider absent, or booking missing/not owned',
})
export class FlightBookingsController {
  constructor(private readonly flightBookingsService: FlightBookingsService) {}

  @Post()
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'FLT-19/21: review server-calculated passengers, baggage, prices and policies without reserving seats',
  })
  @ApiCreatedResponse({
    type: FlightSummaryViewDto,
    description:
      'One/two segment summary in USD cents; no hold/payment created',
  })
  prepare(@Body() dto: HoldFlightBookingDto) {
    return this.flightBookingsService.prepareBooking(dto);
  }

  @Post('hold')
  @Authenticated('traveler')
  @ApiCreatedResponse({
    type: FlightHoldViewDto,
    description:
      'Atomic ten-minute reservation of every segment; no confirmation or charge',
  })
  @ApiOperation({
    summary: 'Reserve seats for 10 minutes and create a pending booking',
  })
  holdBooking(
    @Body() dto: HoldFlightBookingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.flightBookingsService.holdBooking(dto, request.authUser.id);
  }

  @Get()
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'FLT-25: own bookings grouped by Upcoming, Past or Cancelled; ten per page',
  })
  @ApiOkResponse({
    type: FlightBookingsPageDto,
    description:
      'Owned bookings, saved passengers/segments and current status; data/meta envelope',
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: FlightBookingQueryDto,
  ) {
    return this.flightBookingsService.list(
      request.authUser.id,
      query.group,
      query.page,
    );
  }

  @Get(':id')
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'FLT-25/26: owned booking details and saved-policy cancellation preview',
  })
  @ApiOkResponse({
    type: FlightBookingViewDto,
    description:
      'Owned booking, including refundPreview before outbound departure',
  })
  get(@Req() request: AuthenticatedRequest, @Param() params: IdParamDto) {
    return this.flightBookingsService.owned(request.authUser.id, params.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'FLT-26: confirm cancellation of the entire booking and reserve the saved-policy refund atomically',
  })
  @ApiOkResponse({
    type: FlightBookingViewDto,
    description:
      'Cancelled booking; seats released and refund reserved for all segments',
  })
  cancel(
    @Body() _body: AccountStatusActionDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
  ) {
    return this.flightBookingsService.cancel(request.authUser.id, params.id);
  }
}
