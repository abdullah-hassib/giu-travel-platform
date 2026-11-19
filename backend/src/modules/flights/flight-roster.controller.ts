import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AuthenticatedRequest } from '../auth/security/session.guard';
import {
  FlightRosterQueryDto,
  FlightRosterResponseDto,
} from './dto/flight-roster.dto';
import { FlightRosterService } from './flight-roster.service';

@ApiTags('Flight management')
@ApiBadRequestResponse({
  description: 'Invalid identifier, page or unsupported query field',
})
@ApiNotFoundResponse({ description: 'Flight missing' })
@Controller('flights')
export class FlightRosterController {
  constructor(private readonly roster: FlightRosterService) {}
  @Get(':id/bookings')
  @Authenticated('airline_moderator')
  @ApiOperation({
    summary:
      'FLT-29/ACC-11: own airline flight Confirmed/Cancelled booking roster and per-cabin remaining seats',
    description:
      'Ten bookings per page. Includes passenger names, reference, cabin and seats for this flight segment only. Completed reservation history is shown as Confirmed. Omits identities, birth dates, contacts, payment and policy data.',
  })
  @ApiOkResponse({ type: FlightRosterResponseDto })
  list(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @Query() query: FlightRosterQueryDto,
  ) {
    return this.roster.list(request.authUser.id, params.id, query.page);
  }
  @Get(':id/passengers/export')
  @Authenticated('airline_moderator')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary:
      'FLT-29: download all own-flight Confirmed/Cancelled passengers as UTF-8 CSV',
    description:
      'All pages, one passenger per row, with CSV quoting and spreadsheet-formula protection. Includes no passport/contact/payment/policy fields.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async export(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
  ): Promise<StreamableFile> {
    const csv = await this.roster.exportCsv(request.authUser.id, params.id);
    return new StreamableFile(csv, {
      type: 'text/csv; charset=utf-8',
      disposition:
        'attachment; filename="flight-' + params.id + '-passengers.csv"',
    });
  }
}
