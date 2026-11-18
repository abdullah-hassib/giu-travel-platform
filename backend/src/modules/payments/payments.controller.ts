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
  ApiCreatedResponse,
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
import {
  CreatePaymentDto,
  PaymentAttemptDto,
  PaymentIdDto,
  PaymentViewDto,
  RetryPaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description:
    'Traveler access required; complete any mandatory password change',
})
@ApiBadRequestResponse({
  description: 'Invalid identifiers, fields or provider amount limits',
})
@ApiNotFoundResponse({
  description: 'Booking/payment missing or inaccessible to this owner',
})
@ApiConflictResponse({
  description:
    'Policies require acceptance, hold expired, quote changed or operation already in progress',
})
@ApiBadGatewayResponse({ description: 'Invalid booking/gateway response' })
@ApiServiceUnavailableResponse({
  description:
    'Private Stripe setup, booking adapter or temporary gateway availability missing',
})
@UseGuards(SessionGuard, RolesGuard)
@Roles('traveler')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'PAY-01/PAY-02: initiate the owned held booking’s policy-accepted USD payment',
  })
  @ApiCreatedResponse({ type: PaymentAttemptDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreatePaymentDto) {
    return this.payments.create(
      request.authUser.id,
      dto.bookingType,
      dto.bookingId,
    );
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'PAY-01: reconcile/reuse the owned intent while its booking hold remains active',
  })
  @ApiOkResponse({ type: PaymentAttemptDto })
  retry(
    @Body() _dto: RetryPaymentDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: PaymentIdDto,
  ) {
    return this.payments.retry(request.authUser.id, params.id);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'PAY-01: read owned payment and refund state without a client secret',
  })
  @ApiOkResponse({ type: PaymentViewDto })
  get(@Req() request: AuthenticatedRequest, @Param() params: PaymentIdDto) {
    return this.payments.getOwned(request.authUser.id, params.id);
  }
}
