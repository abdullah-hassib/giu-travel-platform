import { Body, Header, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import { Roles, RolesGuard } from '../auth/security/roles.guard';

import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsService } from './flights.service';
import { FlightViewDto } from './dto/flight-view.dto';

@ApiTags('Flights')
@ApiCookieAuth('giu_session')
@Controller('flights')
@UseGuards(SessionGuard, RolesGuard)
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @Roles('airline_moderator')
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
