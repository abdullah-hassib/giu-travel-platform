import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageNumberDto } from '../../../common/dto/page-number.dto';
import {
  REPORT_TARGET_TYPES,
  ReportTargetType,
} from '../../../common/moderation';
import {
  REPORT_STATUSES,
  ReportStatus,
} from '../schemas/content-report.schema';

export class CreateReportDto {
  @ApiProperty({ enum: REPORT_TARGET_TYPES })
  @IsIn(REPORT_TARGET_TYPES)
  targetType!: ReportTargetType;

  @ApiProperty()
  @IsMongoId()
  targetId!: string;

  @ApiProperty({ maxLength: 500, example: 'Spam link in the text' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ReportsQueryDto extends PageNumberDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES, default: 'open' })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status: ReportStatus = 'open';
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['dismiss', 'hide', 'delete'] })
  @IsIn(['dismiss', 'hide', 'delete'])
  action!: 'dismiss' | 'hide' | 'delete';
}

export class ContentParamsDto {
  @ApiProperty({ enum: REPORT_TARGET_TYPES })
  @IsIn(REPORT_TARGET_TYPES)
  type!: ReportTargetType;

  @ApiProperty()
  @IsMongoId()
  id!: string;
}
