import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageNumberDto } from '../../../common/dto/page-number.dto';
import { POST_STATUSES, PostStatus } from '../schemas/blog.schemas';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const tag = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const tags = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((entry) => tag({ value: entry })) : value;
const isPresent = (_dto: object, value: unknown) => value !== undefined;

export class CreatePostDto {
  @ApiProperty({ maxLength: 150, example: 'Three days in Cairo' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiProperty({ maxLength: 20000 })
  @IsString()
  @Matches(/\S/, { message: 'body must not be empty' })
  @MaxLength(20000)
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['egypt', 'food'],
    description: 'Up to 5 tags, 30 characters each',
  })
  @ValidateIf(isPresent)
  @Transform(tags)
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(30, { each: true })
  @ArrayUnique()
  tags?: string[];

  @ApiPropertyOptional({
    enum: POST_STATUSES,
    description: 'Defaults to draft',
  })
  @ValidateIf(isPresent)
  @IsIn(POST_STATUSES)
  status?: PostStatus;
}

export class UpdatePostDto extends PartialType(CreatePostDto, {
  skipNullProperties: false,
}) {}

export class PostListQueryDto extends PageNumberDto {
  @ApiPropertyOptional({ example: 'egypt' })
  @IsOptional()
  @Transform(tag)
  @IsString()
  @MaxLength(30)
  tag?: string;

  @ApiPropertyOptional({
    description: 'Keyword in title, tags or author name (BLG-09)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;
}

export class TagParamDto {
  @ApiProperty({ example: 'egypt' })
  @Transform(tag)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  tag!: string;
}

export class AuthorQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  postsPage = 1;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage = 1;
}

export class CommentDto {
  @ApiProperty({ maxLength: 500, example: 'Thanks for the tips!' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Comment must not be empty' })
  @MaxLength(500)
  body!: string;
}
