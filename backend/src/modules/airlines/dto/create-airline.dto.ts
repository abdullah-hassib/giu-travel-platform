import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsMongoId, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: 'MS' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @MaxLength(10)
  code!: string;

  @ApiProperty({ example: 'https://example.com/egyptair.png' })
  @IsUrl({ require_protocol: true })
  logoUrl!: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  moderatorId!: string;
}
