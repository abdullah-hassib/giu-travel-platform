import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { IsAirlineLogoUrl } from './airline-logo-url.validator';

export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: 'MS' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(1, 10)
  @MaxLength(10)
  code!: string;

  @ApiPropertyOptional({
    example: 'https://example.com/egyptair.png',
    description:
      'Legacy absolute logo URL. New profiles may instead upload one JPG/PNG as multipart file. A patch may echo its current stored media URL.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsAirlineLogoUrl()
  logoUrl?: string;
}
