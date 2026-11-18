import {
  Body,
  Header,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
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
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { AirlineIdParamDto } from './dto/airline-id-param.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';
import { AirlineViewDto } from './dto/airline-view.dto';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import { Roles, RolesGuard } from '../auth/security/roles.guard';

@ApiTags('Airlines')
@ApiCookieAuth('giu_session')
@Controller('airlines')
@UseGuards(SessionGuard, RolesGuard)
@ApiBadRequestResponse({
  description: 'Invalid profile, identifier or policy; extra fields rejected',
})
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description:
    'Required role/provider assignment or completed mandatory password change missing',
})
@ApiNotFoundResponse({ description: 'Airline does not exist' })
@ApiConflictResponse({
  description: 'Airline code already exists or provider state changed',
})
export class AirlinesController {
  constructor(private readonly airlinesService: AirlinesService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ type: AirlineViewDto })
  @Roles('admin')
  @ApiOperation({
    summary:
      'FLT-01: create an airline; provision its moderator through administration',
  })
  create(@Body() dto: CreateAirlineDto, @Req() request: AuthenticatedRequest) {
    return this.airlinesService.create(dto, request.authUser.id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AirlineViewDto })
  @Roles('airline_moderator')
  @ApiOperation({
    summary: 'Update the authenticated moderator’s assigned airline',
  })
  update(
    @Param() params: AirlineIdParamDto,
    @Body() dto: UpdateAirlineDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.airlinesService.updateOwnAirline(
      request.authUser.id,
      params.id,
      dto,
    );
  }

  @Put(':id/baggage-policy')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AirlineViewDto })
  @Roles('airline_moderator')
  @ApiOperation({ summary: 'Update airline baggage policy' })
  updateBaggagePolicy(
    @Param() params: AirlineIdParamDto,
    @Body() dto: BaggagePolicyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.airlinesService.updateBaggagePolicy(
      request.authUser.id,
      params.id,
      dto,
    );
  }

  @Put(':id/cancellation-policy')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AirlineViewDto })
  @Roles('airline_moderator')
  @ApiOperation({ summary: 'Update airline cancellation policy' })
  updateCancellationPolicy(
    @Param() params: AirlineIdParamDto,
    @Body() dto: CancellationPolicyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.airlinesService.updateCancellationPolicy(
      request.authUser.id,
      params.id,
      dto,
    );
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AirlineViewDto })
  @ApiOperation({ summary: 'Get airline details by ID' })
  findById(@Param() params: AirlineIdParamDto) {
    return this.airlinesService.findById(params.id);
  }
}
