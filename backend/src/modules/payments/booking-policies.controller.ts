import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { BookingPoliciesService } from './booking-policies.service';
import {
  AcceptBookingPoliciesDto,
  BookingPolicyParamsDto,
  BookingPolicyReviewDto,
} from './dto/booking-policies.dto';

@ApiTags('Booking policies')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description:
    'Traveler access required; complete any mandatory password change',
})
@ApiBadRequestResponse({
  description: 'Invalid booking kind, identifier or acceptance body',
})
@ApiNotFoundResponse({
  description: 'Booking not found or inaccessible to this owner',
})
@ApiServiceUnavailableResponse({
  description:
    'The booking owner has not configured this kind’s payment adapter',
})
@ApiBadGatewayResponse({
  description: 'The booking adapter returned invalid policy data',
})
@UseGuards(SessionGuard, RolesGuard)
@Roles('traveler')
@Controller('bookings/:type/:id')
export class BookingPoliciesController {
  constructor(private readonly policies: BookingPoliciesService) {}

  @Get('policies')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'PAY-02: review an owned booking’s applicable policies and current acceptance',
  })
  @ApiOkResponse({ type: BookingPolicyReviewDto })
  review(
    @Req() request: AuthenticatedRequest,
    @Param() params: BookingPolicyParamsDto,
  ) {
    return this.policies.review(request.authUser.id, params.type, params.id);
  }

  @Post('accept-policies')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'PAY-02: explicitly accept the reviewed policy snapshot during an active hold',
  })
  @ApiOkResponse({ type: BookingPolicyReviewDto })
  @ApiConflictResponse({
    description:
      'Hold expired, booking state changed or policies/quote changed; review again',
  })
  accept(
    @Req() request: AuthenticatedRequest,
    @Param() params: BookingPolicyParamsDto,
    @Body() dto: AcceptBookingPoliciesDto,
  ) {
    return this.policies.accept(
      request.authUser.id,
      params.type,
      params.id,
      dto.policyToken,
    );
  }
}
