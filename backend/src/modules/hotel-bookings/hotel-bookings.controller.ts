import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Authenticated,
  CurrentUser,
} from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PublicUser } from '../users/users.service';
import {
  CreateHotelBookingDto,
  MyBookingsQueryDto,
} from './dto/hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('Hotel bookings')
@ApiBadRequestResponse({ description: 'Invalid input or stay dates' })
@ApiNotFoundResponse({
  description: 'Booking, hotel or room not found (or not yours)',
})
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Post()
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'HTL-16/HTL-18: hold one or more rooms of a hotel for 10 minutes (Pending Payment)',
    description:
      'All rooms are held together or not at all. Total = sum of nights x each room price. ' +
      'Pay through the payment API before holdExpiresAt; the reservation is confirmed only after verified payment.',
  })
  @ApiConflictResponse({
    description:
      'A room is reserved, held or blocked for these dates; nothing was held',
  })
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateHotelBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get()
  @Authenticated('traveler')
  @ApiOperation({
    summary: 'HTL-20: my reservations grouped as upcoming, past or cancelled',
  })
  listMine(
    @CurrentUser() user: PublicUser,
    @Query() query: MyBookingsQueryDto,
  ) {
    return this.bookings.listMine(user, query);
  }

  @Get(':id')
  @Authenticated('traveler', 'hotel_moderator', 'admin')
  @ApiOperation({
    summary:
      'HTL-20/ACC-11: reservation details, including the refund if cancelled today',
    description:
      "Visible to the owner, admins and the hotel's own moderator only.",
  })
  get(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.bookings.getForViewer(user, params.id);
  }

  @Post(':id/cancel')
  @Authenticated('traveler')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'HTL-21: cancel my whole Confirmed reservation before check-in',
    description:
      "Refund uses the hotel's tier with the highest threshold not above the days left (0% if none).",
  })
  @ApiConflictResponse({
    description: 'Not Confirmed, or check-in date reached',
  })
  cancel(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.bookings.cancel(user, params.id);
  }
}
