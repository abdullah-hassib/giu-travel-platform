import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import {
  SessionGuard,
  AuthenticatedRequest,
} from '../auth/security/session.guard';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { DayIdDto, ItineraryIdDto } from '../itineraries/dto/itinerary.dto';
import { ItineraryViewDto } from '../itineraries/dto/itinerary-view.dto';
import {
  CreateBudgetDto,
  CreateTransportDto,
  NativeBudgetSummaryQueryDto,
  UpdateBudgetDto,
  UpdateTransportDto,
} from './dto/budget.dto';
import { BudgetSummaryDto } from './dto/converted-budget-summary.dto';
import { FxRatesService } from './fx-rates.service';
import { convertedBudgetSummary } from './converted-budget-summary';

@ApiTags('Itinerary budgets')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiBadRequestResponse({
  description: 'Invalid amount, category, currency, city, identifier or fields',
})
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description:
    'Traveler access required; complete any mandatory password change',
})
@ApiNotFoundResponse({
  description: 'Entry, day or itinerary missing or inaccessible to this owner',
})
@ApiConflictResponse({ description: 'Concurrent edit; reload and retry' })
@UseGuards(SessionGuard, RolesGuard)
@Roles('traveler')
@Controller()
export class BudgetingController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly fx: FxRatesService,
  ) {}

  @Post('itineraries/:id/days/:dayId/budgets')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-14: add a daily budget entry in original currency',
  })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  createBudget(
    @Req() request: AuthenticatedRequest,
    @Param() params: DayIdDto,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.itineraries.addBudget(
      request.authUser.id,
      params.id,
      params.dayId,
      dto,
    );
  }

  @Patch('budgets/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ITN-14: edit an owned budget entry' })
  @ApiOkResponse({ type: ItineraryViewDto })
  updateBudget(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.itineraries.updateBudget(request.authUser.id, params.id, dto);
  }

  @Delete('budgets/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-14: delete an owned budget entry and recalculate totals',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  deleteBudget(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
  ) {
    return this.itineraries.deleteBudget(request.authUser.id, params.id);
  }

  @Post('itineraries/:id/transport-costs')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-16: add an intercity transport cost assigned to an owned day',
  })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  createTransport(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: CreateTransportDto,
  ) {
    return this.itineraries.addTransport(request.authUser.id, params.id, dto);
  }

  @Patch('transport-costs/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-16: edit/move an owned transport cost between existing days',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  updateTransport(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
    @Body() dto: UpdateTransportDto,
  ) {
    return this.itineraries.updateTransport(
      request.authUser.id,
      params.id,
      dto,
    );
  }

  @Delete('transport-costs/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ITN-16: delete an owned transport cost and recalculate totals',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  deleteTransport(
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
  ) {
    return this.itineraries.deleteTransport(request.authUser.id, params.id);
  }

  @Get('itineraries/:id/budget-summary')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-14/ITN-18: native totals and preferred-currency conversion with cached daily rates',
  })
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiServiceUnavailableResponse({
    description:
      'FX unavailable with no usable cached rates. Original amounts remain available on the itinerary.',
  })
  async summary(
    @Query() _query: NativeBudgetSummaryQueryDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: ItineraryIdDto,
  ) {
    const native = await this.itineraries.budgetSummary(
      request.authUser.id,
      params.id,
    );
    const currency = request.authUser.preferredCurrency;
    if (!currency) return native;
    return {
      ...native,
      converted: convertedBudgetSummary(
        native,
        currency,
        await this.fx.current(),
      ),
    };
  }
}
