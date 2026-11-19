import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AuthenticatedRequest } from '../auth/security/session.guard';
import { FlightEticketService } from './flight-eticket.service';

@ApiTags('Flight Bookings')
@Controller('flight-bookings')
export class FlightEticketController {
  constructor(private readonly tickets: FlightEticketService) {}
  @Get(':id/e-ticket')
  @Authenticated('traveler')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'FLT-23: download the own confirmed flight e-ticket as PDF',
    description:
      'Confirmed/Completed owned bookings only. Includes both saved segments with airport-local times, passengers, cabin, saved baggage and USD total. Omits identity documents, dates of birth, contacts and payment identifiers. Downloads are regenerated privately; no public file is stored.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiBadRequestResponse({ description: 'Invalid booking identifier' })
  @ApiNotFoundResponse({ description: 'Booking missing or not owned' })
  @ApiConflictResponse({ description: 'Booking not Confirmed/Completed' })
  async download(
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
  ): Promise<StreamableFile> {
    return new StreamableFile(
      await this.tickets.download(request.authUser.id, params.id),
      {
        type: 'application/pdf',
        disposition:
          'attachment; filename="flight-' + params.id + '-eticket.pdf"',
      },
    );
  }
}
