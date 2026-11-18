import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ReferenceDataService } from './reference-data.service';
import { FindAirportsDto } from './dto/find-airports.dto';

@ApiTags('Reference Data')
@Controller('airports')
export class ReferenceDataController {
  constructor(
    private readonly referenceDataService: ReferenceDataService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List and search official airports' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'cityId', required: false })
  @ApiQuery({ name: 'countryCode', required: false })
  findAll(@Query() query: FindAirportsDto) {
    return this.referenceDataService.findAll(query);
  }

  @Get(':iataCode')
  @ApiOperation({ summary: 'Get airport details by IATA code' })
  @ApiParam({ name: 'iataCode', example: 'CAI' })
  findByIataCode(@Param('iataCode') iataCode: string) {
    return this.referenceDataService.findByIataCode(iataCode);
  }
}
