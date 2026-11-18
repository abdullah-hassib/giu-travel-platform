import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toUpperCase() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class ReferenceQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: Math.floor(Number.MAX_SAFE_INTEGER / 10),
    default: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Math.floor(Number.MAX_SAFE_INTEGER / 10))
  page = 1;
  @ApiPropertyOptional({
    description: 'Literal case-insensitive name/identifier substring',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}
export class CitiesQueryDto extends ReferenceQueryDto {
  @ApiPropertyOptional({ description: 'Official country code, for example EG' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
}
export class LocationsQueryDto extends CitiesQueryDto {
  @ApiPropertyOptional({
    description: 'Official city ID, for example new_york',
  })
  @IsOptional()
  @Transform(lower)
  @Matches(/^[a-z][a-z0-9_-]{0,99}$/)
  cityId?: string;
}
export class CountryCodeDto {
  @ApiProperty({ example: 'EG' })
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/)
  code!: string;
}
export class AirportCodeDto {
  @ApiProperty({ example: 'CAI' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/)
  code!: string;
}
export class CurrencyCodeDto {
  @ApiProperty({ example: 'EGP' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/)
  code!: string;
}
export class ReferenceIdDto {
  @ApiProperty({ example: 'cairo' })
  @Transform(lower)
  @Matches(/^[a-z][a-z0-9_-]{0,99}$/)
  id!: string;
}
export class CountryDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() currency!: string;
}
export class CityDto {
  @ApiProperty() city_id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() country_code!: string;
}
export class AirportDto extends CityDto {
  @ApiProperty() iata_code!: string;
  @ApiProperty({ description: 'Original IANA time zone from Airports.csv' })
  time_zone!: string;
}
export class AttractionDto {
  @ApiProperty() attraction_id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() city_id!: string;
}
export class CurrencyDto {
  @ApiProperty() code!: string;
}
export class ReferencePageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class CountriesPageDto {
  @ApiProperty({ type: [CountryDto] }) data!: CountryDto[];
  @ApiProperty({ type: ReferencePageMetaDto }) meta!: ReferencePageMetaDto;
}
export class CitiesPageDto {
  @ApiProperty({ type: [CityDto] }) data!: CityDto[];
  @ApiProperty({ type: ReferencePageMetaDto }) meta!: ReferencePageMetaDto;
}
export class AirportsPageDto {
  @ApiProperty({ type: [AirportDto] }) data!: AirportDto[];
  @ApiProperty({ type: ReferencePageMetaDto }) meta!: ReferencePageMetaDto;
}
export class AttractionsPageDto {
  @ApiProperty({ type: [AttractionDto] }) data!: AttractionDto[];
  @ApiProperty({ type: ReferencePageMetaDto }) meta!: ReferencePageMetaDto;
}
export class CurrenciesPageDto {
  @ApiProperty({ type: [CurrencyDto] }) data!: CurrencyDto[];
  @ApiProperty({ type: ReferencePageMetaDto }) meta!: ReferencePageMetaDto;
}
