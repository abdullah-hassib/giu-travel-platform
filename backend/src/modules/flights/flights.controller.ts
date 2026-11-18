import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import {
  Roles,
  RolesGuard,
} from '../auth/security/roles.guard';

import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@ApiCookieAuth('giu_session')
@Controller('flights')
@UseGuards(SessionGuard, RolesGuard)
export class FlightsController {
  constructor(
    private readonly flightsService: FlightsService,
  ) {}

  @Post()
  @Roles('airline_moderator')
  @ApiOperation({
    summary: 'Create a flight with cabin inventory',
  })
  create(
    @Body() dto: CreateFlightDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.flightsService.createForModerator(
      request.authUser.id,
      dto,
    );
  }
}
