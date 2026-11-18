import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ReferenceDataService } from './reference-data.service';
import {
  AirportCodeDto,
  AirportDto,
  AirportsPageDto,
  AttractionDto,
  AttractionsPageDto,
  CitiesPageDto,
  CitiesQueryDto,
  CityDto,
  CountriesPageDto,
  CountryCodeDto,
  CountryDto,
  CurrenciesPageDto,
  CurrencyCodeDto,
  CurrencyDto,
  LocationsQueryDto,
  ReferenceIdDto,
  ReferenceQueryDto,
} from './reference.dto';

@ApiTags('Official reference data')
@ApiBadRequestResponse({
  description:
    'Invalid identifier/filter, unsupported query field or mismatched city/country',
})
@ApiNotFoundResponse({
  description: 'Official reference or filter location does not exist',
})
@ApiServiceUnavailableResponse({
  description: 'Official reference dataset has not been seeded',
})
@Controller()
export class ReferenceDataController {
  constructor(private readonly references: ReferenceDataService) {}
  @Get('countries')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-12: public read-only countries, ten per page' })
  @ApiOkResponse({ type: CountriesPageDto })
  countries(@Query() query: ReferenceQueryDto) {
    return this.references.countries(query);
  }
  @Get('countries/:code')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CountryDto })
  @ApiOperation({ summary: 'GEN-12: official country and currency lookup' })
  country(@Param() param: CountryCodeDto) {
    return this.references.getCountry(param.code);
  }
  @Get('cities')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CitiesPageDto })
  @ApiOperation({ summary: 'GEN-12: public city lookup/search by country' })
  cities(@Query() query: CitiesQueryDto) {
    return this.references.cities(query);
  }
  @Get('cities/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CityDto })
  @ApiOperation({ summary: 'GEN-12: official city lookup' })
  city(@Param() param: ReferenceIdDto) {
    return this.references.getCity(param.id);
  }
  @Get('airports')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AirportsPageDto })
  @ApiOperation({
    summary:
      'FLT-02/GEN-12: official airports with IANA time zones; location filters and search',
  })
  airports(@Query() query: LocationsQueryDto) {
    return this.references.airports(query);
  }
  @Get('airports/:code')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AirportDto })
  @ApiOperation({
    summary: 'FLT-02: authoritative airport/city/country/time-zone lookup',
  })
  airport(@Param() param: AirportCodeDto) {
    return this.references.getAirport(param.code);
  }
  @Get('attractions')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AttractionsPageDto })
  @ApiOperation({
    summary: 'GEN-12: public attraction lookup/search by city/country',
  })
  attractions(@Query() query: LocationsQueryDto) {
    return this.references.attractions(query);
  }
  @Get('attractions/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AttractionDto })
  @ApiOperation({ summary: 'GEN-12: official attraction lookup' })
  attraction(@Param() param: ReferenceIdDto) {
    return this.references.getAttraction(param.id);
  }
  @Get('currencies')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CurrenciesPageDto })
  @ApiOperation({
    summary: 'GEN-12: supported currency codes from official countries only',
  })
  currencies(@Query() query: ReferenceQueryDto) {
    return this.references.currencies(query);
  }
  @Get('currencies/:code')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CurrencyDto })
  @ApiOperation({ summary: 'GEN-12: validate a supported currency code' })
  currency(@Param() param: CurrencyCodeDto) {
    return this.references.getCurrency(param.code);
  }
}
