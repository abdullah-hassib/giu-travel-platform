import {
  Body,
  Header,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';

import { AuthenticatedRequest } from '../auth/security/session.guard';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { FlightSearchService } from './flight-search.service';
import { FlightSearchDto } from './dto/flight-search.dto';
import {
  FlightSearchResponseDto,
  PublicFlightDetailsDto,
} from './dto/flight-search-view.dto';

import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsService } from './flights.service';
import { FlightViewDto } from './dto/flight-view.dto';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly searchService: FlightSearchService,
  ) {}

  @Get('search')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'FLT-11/12/15: public one-way/round-trip search, grouped by flight with eligible cabin choices',
    description:
      'Dates use each departure airport local calendar. Availability excludes held/booked seats and inactive/departed/cancelled flights. Inclusive price filters and sorting apply to the whole selected party per leg, before optional bags. Ten distinct flights per page; each cabin must fit the seated passengers. Selecting a valid round-trip pair is checked again atomically when holding seats.',
  })
  @ApiOkResponse({ type: FlightSearchResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid/reversed dates/prices, passengers or unknown query fields',
  })
  @ApiNotFoundResponse({
    description: 'Airport outside the official reference list',
  })
  search(@Query() query: FlightSearchDto) {
    return this.searchService.search(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'FLT-17/30: public flight details with local/UTC times, cabin availability and current airline policies',
  })
  @ApiOkResponse({ type: PublicFlightDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid flight identifier' })
  @ApiNotFoundResponse({ description: 'Flight or active airline absent' })
  details(@Param() params: IdParamDto) {
    return this.searchService.details(params.id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Authenticated('airline_moderator')
  @ApiCreatedResponse({ type: FlightViewDto })
  @ApiBadRequestResponse({
    description:
      'Invalid cabins, airports or local date/time (including DST gaps/overlaps)',
  })
  @ApiConflictResponse({
    description: 'Duplicate flight number/airline/local departure date',
  })
  @ApiNotFoundResponse({
    description: 'Airport absent from the official reference set',
  })
  @ApiForbiddenResponse({
    description:
      'Active assigned airline moderator required; complete mandatory password change',
  })
  @ApiUnauthorizedResponse({ description: 'Active session required' })
  @ApiOperation({
    summary: 'Create a flight with cabin inventory',
  })
  create(@Body() dto: CreateFlightDto, @Req() request: AuthenticatedRequest) {
    return this.flightsService.createForModerator(request.authUser.id, dto);
  }
}
