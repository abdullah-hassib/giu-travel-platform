import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
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
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, Matches } from 'class-validator';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { IsCalendarDate } from '../../common/dto/page-number.dto';
import { AuthenticatedRequest } from '../auth/security/session.guard';
import { FlightSearchDto } from '../flights/dto/flight-search.dto';
import { FlightSearchResponseDto } from '../flights/dto/flight-search-view.dto';
import { FlightSearchService } from '../flights/flight-search.service';
import { OFFICIAL_REFERENCE } from '../reference-data/official-reference';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { itineraryDate } from './calendar';
import { ItinerariesService } from './itineraries.service';

export class ItineraryFlightsQueryDto extends OmitType(FlightSearchDto, [
  'departureAirportCode',
  'arrivalAirportCode',
  'departureDate',
  'returnDate',
] as const) {
  @ApiProperty({
    description: 'Chosen origin from the official IATA airport list',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/)
  originAirportCode!: string;
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'Enable return search defaulting to the last itinerary day',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  roundTrip: boolean = false;
  @ApiPropertyOptional({
    description: 'Defaults to itinerary start date; local at origin',
  })
  @IsOptional()
  @IsCalendarDate()
  departureDate?: string;
  @ApiPropertyOptional({
    description:
      'Explicit return date enables return search; otherwise roundTrip uses last day',
  })
  @IsOptional()
  @IsCalendarDate()
  returnDate?: string;
}
class ItineraryFlightSelectionDto {
  @ApiProperty() cityId!: string;
  @ApiProperty({ type: [String] }) destinationAirportCodes!: string[];
  @ApiProperty() departureDate!: string;
  @ApiProperty({ type: String, nullable: true }) returnDate!: string | null;
}
export class ItineraryFlightsResponseDto extends FlightSearchResponseDto {
  @ApiProperty({ type: ItineraryFlightSelectionDto })
  selection!: ItineraryFlightSelectionDto;
}

@Injectable()
export class ItineraryFlightsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly flights: FlightSearchService,
    private readonly reference: ReferenceDataService,
  ) {}
  async search(
    ownerId: string,
    id: string,
    query: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightsResponseDto> {
    const trip = await this.itineraries.get(ownerId, id);
    if (!trip.days.length)
      throw new BadRequestException(
        'Add a first itinerary day before searching flights',
      );
    const cityId = trip.days[0].cityId;
    await this.reference.getCity(cityId);
    const codes = OFFICIAL_REFERENCE.airports
      .filter((airport) => airport.city_id === cityId)
      .map((airport) => airport.iata_code);
    const departureDate = query.departureDate ?? trip.startDate;
    const returnDate =
      query.returnDate ??
      (query.roundTrip
        ? itineraryDate(trip.startDate, trip.days.length - 1)
        : undefined);
    const search = Object.assign(new FlightSearchDto(), {
      departureAirportCode: query.originAirportCode,
      arrivalAirportCode: codes[0] ?? query.originAirportCode,
      departureDate,
      returnDate,
      passengers: query.passengers,
      children: query.children,
      infants: query.infants,
      cabinCategory: query.cabinCategory,
      minPriceMinor: query.minPriceMinor,
      maxPriceMinor: query.maxPriceMinor,
      sortBy: query.sortBy,
      order: query.order,
      page: query.page,
      returnPage: query.returnPage,
    });
    return {
      selection: {
        cityId,
        destinationAirportCodes: codes,
        departureDate,
        returnDate: returnDate ?? null,
      },
      ...(await this.flights.search(search, codes)),
    };
  }
}

@ApiTags('Itineraries')
@Controller('itineraries')
export class ItineraryFlightsController {
  constructor(private readonly flights: ItineraryFlightsService) {}
  @Get(':id/flights')
  @Authenticated('traveler')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-26: reuse public flight search to the first itinerary city, with owned dates/airports derived server-side',
    description:
      'Choose originAirportCode and passenger counts. The current first day determines all destination airports. Dates default to the itinerary start/last day; optional overrides and the same public price/cabin/sort/page filters are validated. No hold/payment is created.',
  })
  @ApiOkResponse({ type: ItineraryFlightsResponseDto })
  @ApiBadRequestResponse({
    description:
      'Empty itinerary, invalid origin/date/passenger/filter or unsupported query fields',
  })
  @ApiNotFoundResponse({
    description: 'Itinerary missing/not owned or unknown official reference',
  })
  search(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Query() query: ItineraryFlightsQueryDto,
  ) {
    return this.flights.search(request.authUser.id, params.id, query);
  }
}
