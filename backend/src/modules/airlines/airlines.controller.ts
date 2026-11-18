import {
  Body,
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
} from '@nestjs/swagger';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { AirlineIdParamDto } from './dto/airline-id-param.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import {
  Roles,
  RolesGuard,
} from '../auth/security/roles.guard';

@ApiTags('Airlines')
@ApiCookieAuth('giu_session')
@Controller('airlines')
@UseGuards(SessionGuard, RolesGuard)
export class AirlinesController {
  constructor(private readonly airlinesService: AirlinesService) {}

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary: 'Create an airline and assign its airline moderator',
  })
  create(@Body() dto: CreateAirlineDto) {
    return this.airlinesService.create(dto);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'Get airline details by ID' })
  findById(@Param() params: AirlineIdParamDto) {
    return this.airlinesService.findById(params.id);
  }
}
