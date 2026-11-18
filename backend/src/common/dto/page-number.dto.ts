import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PageResult } from './page-query.dto';

/** GEN-05: every list is paginated with a fixed page size of 10. */
export const PAGE_SIZE = 10;

export class PageNumberDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}

export function toPage<T>(
  data: T[],
  page: number,
  total: number,
): PageResult<T> {
  return {
    data,
    meta: {
      page,
      limit: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  };
}

/** A real calendar date written as YYYY-MM-DD. */
export const IsCalendarDate = () =>
  applyDecorators(
    IsString(),
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Dates must use YYYY-MM-DD' }),
    IsDateString({ strict: true }),
  );
