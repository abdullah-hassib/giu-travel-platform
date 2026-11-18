import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingPassengerDto {
  @ApiProperty({ example: 'Ahmed Mohamed', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  fullName!: string;

  @ApiProperty({
    example: '2000-05-15',
    description: 'Date of birth in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth!: string;

  @ApiProperty({ example: 'A12345678', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  identityDocumentNumber!: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    default: 0,
    description: 'Number of additional baggage pieces',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  extraBags = 0;
}
