import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUrl, Length, MaxLength } from 'class-validator';

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

  @ApiProperty({ example: 'https://example.com/egyptair.png' })
  @IsUrl({ require_protocol: true })
  logoUrl!: string;
}
