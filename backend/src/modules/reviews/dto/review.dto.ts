import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Great view and friendly staff.',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateReviewDto extends PartialType(CreateReviewDto, {
  skipNullProperties: false,
}) {}
