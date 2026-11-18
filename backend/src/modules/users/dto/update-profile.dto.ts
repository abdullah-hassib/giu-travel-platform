import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsPhoneNumber, IsString, Length, ValidateIf } from 'class-validator';
import { CURRENCIES } from '../../reference-data/official-reference';

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @ApiPropertyOptional({ example: '+201001234567', nullable: true, description: 'International phone number with country code. Set null to clear.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsPhoneNumber()
  phone?: string | null;

  @ApiPropertyOptional({ enum: CURRENCIES, example: 'EGP' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(CURRENCIES)
  preferredCurrency?: string;
}
