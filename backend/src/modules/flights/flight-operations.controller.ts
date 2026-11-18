import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AuthenticatedRequest } from '../auth/security/session.guard';
import { CreateFlightCabinDto } from './dto/create-flight-cabin.dto';
import {
  CancelFlightDto,
  CancelFlightResultDto,
  FlightCabinParamsDto,
  UpdateFlightCabinDto,
  UpdateFlightDto,
} from './dto/flight-management.dto';
import { FlightViewDto } from './dto/flight-view.dto';
import { FlightOperationsService } from './flight-operations.service';

@ApiTags('Flight management')
@ApiBadRequestResponse({
  description:
    'Invalid/empty fields, dates, airports, cabin values or missing cancellation confirmation',
})
@ApiNotFoundResponse({
  description: 'Flight, cabin or official airport missing',
})
@ApiConflictResponse({
  description:
    'Only future Scheduled flights may change; airports fixed after any booking; seats cannot drop below booked plus held',
})
@Controller('flights')
export class FlightOperationsController {
  constructor(private readonly operations: FlightOperationsService) {}
  @Patch(':id')
  @Authenticated('airline_moderator')
  @ApiOperation({
    summary:
      'FLT-05: edit own Scheduled flight times/airports and notify Confirmed booking owners',
    description:
      'Airports may change only before any booking. Supplied times use the selected airports local zones; omitted times preserve UTC instants. Active booking schedules update atomically, while saved prices/policies and ended history stay unchanged.',
  })
  @ApiOkResponse({ type: FlightViewDto })
  update(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Body() dto: UpdateFlightDto,
  ) {
    return this.operations.update(request.authUser.id, params.id, dto);
  }
  @Post(':id/cabins')
  @Authenticated('airline_moderator')
  @ApiOperation({
    summary:
      'FLT-04: add an unused fixed cabin category to an own Scheduled flight',
  })
  @ApiCreatedResponse({ type: FlightViewDto })
  add(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Body() dto: CreateFlightCabinDto,
  ) {
    return this.operations.addCabin(request.authUser.id, params.id, dto);
  }
  @Patch(':id/cabins/:cabinId')
  @Authenticated('airline_moderator')
  @ApiOperation({
    summary:
      'FLT-05: update own cabin price/capacity while preserving booked quotes and occupied seats',
  })
  @ApiOkResponse({ type: FlightViewDto })
  cabin(
    @Req() request: AuthenticatedRequest,
    @Param() params: FlightCabinParamsDto,
    @Body() dto: UpdateFlightCabinDto,
  ) {
    return this.operations.updateCabin(
      request.authUser.id,
      params.id,
      params.cabinId,
      dto,
    );
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Authenticated('airline_moderator')
  @ApiOperation({
    summary:
      'FLT-06: confirm own Scheduled flight cancellation, expire holds and reserve full whole-booking refunds atomically',
  })
  @ApiOkResponse({ type: CancelFlightResultDto })
  cancel(
    @Body() _dto: CancelFlightDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
  ) {
    return this.operations.cancel(request.authUser.id, params.id);
  }
}
