import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';

@ApiTags('Stripe webhook')
@Controller('payments')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}
  @Post('webhook')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'PAY-01/PAY-03: signed test-mode Stripe event; raw bytes are verified before processing',
  })
  @ApiConsumes('application/json')
  @ApiHeader({ name: 'Stripe-Signature', required: true })
  @ApiBody({
    schema: { type: 'object', additionalProperties: true },
    description:
      'Original Stripe event bytes. Request must use a genuine test webhook signature.',
  })
  @ApiOkResponse({
    schema: { type: 'object', properties: { received: { type: 'boolean' } } },
  })
  @ApiBadRequestResponse({
    description: 'Invalid signature, event, mode, resource linkage or raw body',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Webhook setup/integration unavailable or temporary processing failure; delivery must retry',
  })
  @ApiConflictResponse({
    description:
      'Payment/refund is being processed concurrently. Retry delivery.',
  })
  @ApiBadGatewayResponse({
    description:
      'Authoritative gateway response did not match the stored operation. Delivery remains pending.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Durable application failed. Retry delivery.',
  })
  async webhook(@Req() request: Request) {
    const rawBody: unknown = request.body;
    if (!Buffer.isBuffer(rawBody))
      throw new BadRequestException(
        'Original Stripe webhook bytes are required',
      );
    await this.payments.webhook(rawBody, request.get('stripe-signature'));
    return { received: true };
  }
}
