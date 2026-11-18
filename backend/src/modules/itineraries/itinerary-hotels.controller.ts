import {
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
} from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AuthenticatedRequest } from '../auth/security/session.guard';
import { HotelSearchDto } from '../hotels/dto/hotel.dto';
import { HotelsService } from '../hotels/hotels.service';
import { itineraryDate } from './calendar';
import { ItinerariesService } from './itineraries.service';

export class ItineraryHotelsQueryDto extends OmitType(HotelSearchDto, [
  'cityId',
  'countryCode',
  'checkIn',
  'checkOut',
] as const) {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  page: number = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 20, default: 1 })
  rooms: number = 1;

  @ApiProperty({
    description:
      'Any day ID within the chosen consecutive city group of your itinerary',
  })
  @IsMongoId()
  dayId!: string;
}

class HotelResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() cityId!: string;
  @ApiProperty() countryCode!: string;
  @ApiProperty() address!: string;
  @ApiProperty() starRating!: number;
  @ApiProperty({ type: String, nullable: true }) image!: string | null;
  @ApiProperty({ type: Number, nullable: true }) averageRating!: number | null;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() freeRooms!: number;
  @ApiProperty({
    description: 'Cheapest qualifying room per night in USD cents',
  })
  pricePerNightMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
}
class HotelSearchSelectionDto {
  @ApiProperty() cityId!: string;
  @ApiProperty() firstDayNumber!: number;
  @ApiProperty() dayCount!: number;
  @ApiProperty() checkIn!: string;
  @ApiProperty({ description: 'Exclusive: the day after the group ends' })
  checkOut!: string;
}
class HotelPageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class ItineraryHotelsPageDto {
  @ApiProperty({ type: HotelSearchSelectionDto })
  selection!: HotelSearchSelectionDto;
  @ApiProperty({ type: [HotelResultDto] }) data!: HotelResultDto[];
  @ApiProperty({ type: HotelPageMetaDto }) meta!: HotelPageMetaDto;
}

@Injectable()
export class ItineraryHotelsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly hotels: HotelsService,
  ) {}

  async search(
    ownerId: string,
    itineraryId: string,
    query: ItineraryHotelsQueryDto,
  ): Promise<ItineraryHotelsPageDto> {
    const trip = await this.itineraries.get(ownerId, itineraryId);
    const index = trip.days.findIndex(
      (day) => day.id === query.dayId.toLowerCase(),
    );
    if (index < 0)
      throw new NotFoundException('Day not found in this itinerary');
    const group = trip.cityGroups.find(
      (candidate) =>
        index + 1 >= candidate.firstDayNumber &&
        index + 1 < candidate.firstDayNumber + candidate.dayCount,
    )!;
    const selection = {
      cityId: group.cityId,
      firstDayNumber: group.firstDayNumber,
      dayCount: group.dayCount,
      checkIn: group.startDate,
      checkOut: itineraryDate(
        trip.startDate,
        group.firstDayNumber - 1 + group.dayCount,
      ),
    };
    const search = Object.assign(new HotelSearchDto(), {
      guests: query.guests,
      rooms: query.rooms,
      page: query.page,
      minPriceMinor: query.minPriceMinor,
      maxPriceMinor: query.maxPriceMinor,
      minRating: query.minRating,
      sortBy: query.sortBy,
      order: query.order,
      cityId: selection.cityId,
      checkIn: selection.checkIn,
      checkOut: selection.checkOut,
    });
    return { selection, ...(await this.hotels.search(search)) };
  }
}

@ApiTags('Itineraries')
@ApiBadRequestResponse({
  description:
    'Invalid guest/room/filter input, unsupported query fields, past stay or calendar overflow',
})
@ApiNotFoundResponse({
  description:
    'Itinerary or selected day missing or not owned by this traveler',
})
@Controller('itineraries')
export class ItineraryHotelsController {
  constructor(private readonly hotels: ItineraryHotelsService) {}

  @Get(':id/hotels')
  @Authenticated('traveler')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-25: reuse hotel search for an owned consecutive city group',
    description:
      'Choose any dayId within the group and enter guests/rooms. City and inclusive/exclusive stay dates are derived from the current itinerary. Defaults, filters, sorting and availability use the actual hotel search service. Results are not held or booked.',
  })
  @ApiOkResponse({ type: ItineraryHotelsPageDto })
  search(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Query() query: ItineraryHotelsQueryDto,
  ) {
    return this.hotels.search(request.authUser.id, params.id, query);
  }
}
