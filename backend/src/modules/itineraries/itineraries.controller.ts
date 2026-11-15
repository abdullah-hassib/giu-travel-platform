import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import {
  CreateActivityDto,
  CreateDayDto,
  CreateItineraryDto,
  DayIdDto,
  ItineraryIdDto,
  ItineraryPageDto,
  ItinerarySearchDto,
  ReorderDaysDto,
  UpdateActivityDto,
  UpdateDayDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto';
import {
  ItineraryListViewDto,
  ItineraryViewDto,
} from './dto/itinerary-view.dto';
import { ItinerariesService } from './itineraries.service';

@ApiTags('Itineraries')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description:
    'Traveler role required; complete any mandatory password change first',
})
@ApiBadRequestResponse({
  description:
    'Invalid fields, identifiers, date, city/country relationship or day ordering',
})
@ApiNotFoundResponse({
  description: 'Resource missing or inaccessible to this owner',
})
@ApiConflictResponse({
  description: 'Concurrent modification; reload and retry',
})
@UseGuards(SessionGuard, RolesGuard)
@Roles('traveler')
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-01: create an owner-managed private itinerary',
  })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateItineraryDto,
  ) {
    return this.itineraries.create(request.authUser.id, dto);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-03 / GEN-05: list own itineraries, newest updated first, ten per page',
  })
  @ApiOkResponse({ type: ItineraryListViewDto })
  list(@Req() request: AuthenticatedRequest, @Query() query: ItineraryPageDto) {
    return this.itineraries.list(request.authUser.id, query.page);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ITN-03 / ACC-11: read an own itinerary' })
  @ApiOkResponse({ type: ItineraryViewDto })
  get(@Req() request: AuthenticatedRequest, @Param() params: ItineraryIdDto) {
    return this.itineraries.get(request.authUser.id, params.id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-01 / ITN-20: edit title, countries, start date or visibility',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  update(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: UpdateItineraryDto,
  ) {
    return this.itineraries.update(request.authUser.id, params.id, dto);
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ITN-01: delete own itinerary and its embedded days/activities; existing clones are independent',
  })
  @ApiNoContentResponse()
  remove(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
  ) {
    return this.itineraries.remove(request.authUser.id, params.id);
  }

  @Post(':id/days')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ITN-05: append a day, maximum sixty days' })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  addDay(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: CreateDayDto,
  ) {
    return this.itineraries.addDay(request.authUser.id, params.id, dto);
  }

  @Patch(':id/days/reorder')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-08: reorder all days; dates, numbers and consecutive city groups are derived',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  reorder(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: ReorderDaysDto,
  ) {
    return this.itineraries.reorder(request.authUser.id, params.id, dto.dayIds);
  }

  @Patch(':id/days/:dayId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ITN-05: edit city and notes of an own day' })
  @ApiOkResponse({ type: ItineraryViewDto })
  updateDay(
    @Req() request: AuthenticatedRequest,
    @Param() params: DayIdDto,
    @Body() dto: UpdateDayDto,
  ) {
    return this.itineraries.updateDay(
      request.authUser.id,
      params.id,
      params.dayId,
      dto,
    );
  }

  @Delete(':id/days/:dayId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-07: delete a day and its activities; derive dates, groups and activity subtotals again',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  deleteDay(@Req() request: AuthenticatedRequest, @Param() params: DayIdDto) {
    return this.itineraries.deleteDay(
      request.authUser.id,
      params.id,
      params.dayId,
    );
  }

  @Post(':id/days/:dayId/activities')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-10: add an activity with optional local time and original-currency cost',
  })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  addActivity(
    @Req() request: AuthenticatedRequest,
    @Param() params: DayIdDto,
    @Body() dto: CreateActivityDto,
  ) {
    return this.itineraries.addActivity(
      request.authUser.id,
      params.id,
      params.dayId,
      dto,
    );
  }

  @Post(':id/clone')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-21 core: clone public days/activities/costs privately with source attribution; budgets/media are later slices',
  })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  clone(@Req() request: AuthenticatedRequest, @Param() params: ItineraryIdDto) {
    return this.itineraries.clone(request.authUser.id, params.id);
  }
}

@ApiTags('Itinerary activities')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiBadRequestResponse({ description: 'Invalid activity fields or identifier' })
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description: 'Traveler role required; complete any required password change',
})
@ApiNotFoundResponse({
  description: 'Activity missing or inaccessible to this owner',
})
@ApiConflictResponse({
  description: 'Concurrent modification; reload and retry',
})
@UseGuards(SessionGuard, RolesGuard)
@Roles('traveler')
@Controller('activities')
export class ItineraryActivitiesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-10 / ACC-11: edit an activity owned through its itinerary',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  update(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.itineraries.updateActivity(request.authUser.id, params.id, dto);
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-10: delete an own activity and recalculate activity subtotals',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  remove(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
  ) {
    return this.itineraries.deleteActivity(request.authUser.id, params.id);
  }
}

@ApiTags('Public itineraries')
@ApiBadRequestResponse({
  description: 'Invalid filters, duration range or identifier',
})
@Controller('itineraries/public')
export class PublicItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Get('search')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-21 core / GEN-05: public title/country/city search with duration filters, ten per page',
  })
  @ApiOkResponse({ type: ItineraryListViewDto })
  search(@Query() query: ItinerarySearchDto) {
    return this.itineraries.publicSearch(query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-21 core: read a public itinerary with author; deactivated authors are hidden',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  @ApiNotFoundResponse({ description: 'No visible public itinerary' })
  get(@Param() params: ItineraryIdDto) {
    return this.itineraries.publicGet(params.id);
  }
}
