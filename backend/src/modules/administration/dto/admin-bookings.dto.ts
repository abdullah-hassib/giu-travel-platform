import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { IsCalendarDate } from '../../../common/dto/page-number.dto';
import {
  BOOKING_STATUSES,
  BookingStatus,
} from '../../hotel-bookings/schemas/hotel-booking.schema';
import { AccountsPageDto, AccountsQueryDto } from './accounts-query.dto';

export class AdminBookingsQueryDto extends PickType(AccountsQueryDto, [
  'page',
] as const) {
  @ApiPropertyOptional({
    enum: ['hotel', 'flight'],
    description:
      'Specify hotel for the available integration. Flight/combined results return 503 until supplied.',
  })
  @IsOptional()
  @IsIn(['hotel', 'flight'])
  type?: 'hotel' | 'flight';
  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;
  @ApiPropertyOptional({
    description: 'Inclusive booking start date, YYYY-MM-DD',
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;
  @ApiPropertyOptional({
    description: 'Inclusive booking start date, YYYY-MM-DD',
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
class BookingIdentityDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Name saved with the booking' }) name!: string;
}
class BookingDatesDto {
  @ApiProperty() from!: string;
  @ApiProperty({ description: 'Exclusive checkout date for hotels' })
  to!: string;
}
export class AdminBookingViewDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['hotel'] }) type!: 'hotel';
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty({ type: BookingIdentityDto }) user!: BookingIdentityDto;
  @ApiProperty({ type: BookingIdentityDto }) provider!: BookingIdentityDto;
  @ApiProperty({ type: BookingDatesDto }) dates!: BookingDatesDto;
  @ApiProperty({ description: 'Authoritative total in USD cents' })
  amountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ enum: BOOKING_STATUSES }) status!: BookingStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  createdAt!: Date | null;
}
export class AdminBookingsPageDto extends OmitType(AccountsPageDto, [
  'data',
] as const) {
  @ApiProperty({ type: [AdminBookingViewDto] }) data!: AdminBookingViewDto[];
}
