import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { PaymentIdDto, RefundViewDto } from '../payments/dto/payment.dto';
import { RefundsService } from './refunds.service';

@ApiTags('Refunds')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description: 'Traveler access required; complete mandatory password changes',
})
@ApiBadRequestResponse({ description: 'Invalid refund identifier' })
@ApiNotFoundResponse({
  description: 'Refund missing or inaccessible to this owner',
})
@UseGuards(SessionGuard, RolesGuard)
@Roles('traveler')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'PAY-03: read an owned refund status' })
  @ApiOkResponse({ type: RefundViewDto })
  get(@Req() request: AuthenticatedRequest, @Param() params: PaymentIdDto) {
    return this.refunds.getOwned(request.authUser.id, params.id);
  }
}
