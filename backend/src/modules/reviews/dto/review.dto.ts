import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { REVIEW_REPLY_MAX_LENGTH } from '../review.constants';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
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

export class CreateReviewReplyDto {
  @ApiProperty({
    minLength: 1,
    maxLength: REVIEW_REPLY_MAX_LENGTH,
    example: 'Thank you for staying with us. We appreciate your feedback.',
    description:
      'Plain text, trimmed. The 1000-character cap is an implementation limit matching review comments.',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_REPLY_MAX_LENGTH)
  comment!: string;
}
