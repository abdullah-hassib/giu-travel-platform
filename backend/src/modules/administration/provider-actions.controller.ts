import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { Roles, RolesGuard } from '../auth/security/roles.guard';
import {
  AuthenticatedRequest,
  SessionGuard,
} from '../auth/security/session.guard';
import { SESSION_COOKIE_NAME } from '../auth/security/session-cookie';
import { HotelsService } from '../hotels/hotels.service';
import { AirlinesService } from '../airlines/airlines.service';
import { AccountStatusActionDto } from './dto/account-status.dto';

export class ProviderActionParamsDto extends IdParamDto {
  @ApiProperty({ enum: ['hotel', 'airline'] })
  @IsIn(['hotel', 'airline'])
  type!: 'hotel' | 'airline';
}

@ApiTags('Administration')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiUnauthorizedResponse({ description: 'Active session required' })
@ApiForbiddenResponse({
  description:
    'Administrator role required; complete mandatory password change',
})
@ApiBadRequestResponse({
  description: 'Invalid provider type/ID or unsupported body fields',
})
@ApiNotFoundResponse({ description: 'Provider does not exist' })
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
@Controller('admin/providers')
export class ProviderActionsController {
  constructor(private readonly hotels: HotelsService, private readonly airlines: AirlinesService) {}

  @Patch(':type/:id/deactivate')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ACC-15: deactivate a provider while preserving Confirmed bookings',
  })
  @ApiNoContentResponse({
    description:
      'Provider state and durable notification/audit event committed; repeated commands are harmless.',
  })
  async deactivate(
    @Body() _body: AccountStatusActionDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: ProviderActionParamsDto,
  ): Promise<void> {
    await this.change(request.authUser.id, params, false);
  }

  @Patch(':type/:id/reactivate')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-15: reactivate a provider for search and new bookings',
  })
  @ApiNoContentResponse({
    description:
      'Provider state and durable event committed; repeated commands are harmless',
  })
  async reactivate(
    @Body() _body: AccountStatusActionDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: ProviderActionParamsDto,
  ): Promise<void> {
    await this.change(request.authUser.id, params, true);
  }

  private async change(
    actorId: string,
    params: ProviderActionParamsDto,
    active: boolean,
  ): Promise<void> {
    if (params.type === 'airline') return this.airlines.setActive(actorId, params.id, active);
    // The supplied domain service owns the transaction, room fences and outbox.
    await this.hotels.setActive(actorId, params.id, active);
  }
}
