import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { AUDIT_OUTCOMES, AuditOutcome } from '../schemas/audit-log.schema';

export class AuditLogsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  override page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  override limit = 20;

  @ApiPropertyOptional({ enum: ['occurredAt'], default: 'occurredAt' })
  @IsOptional()
  @IsIn(['occurredAt'])
  override sortBy = 'occurredAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override order: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Filter by actor user ObjectId' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(80)
  resourceType?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  resourceId?: string;

  @ApiPropertyOptional({ enum: AUDIT_OUTCOMES })
  @IsOptional()
  @IsIn(AUDIT_OUTCOMES)
  outcome?: AuditOutcome;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditLogDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  resourceType!: string;

  @ApiProperty()
  resourceId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  correlationId!: string | null;

  @ApiProperty({ enum: AUDIT_OUTCOMES })
  outcome!: AuditOutcome;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } })
  metadata?: Record<string, string | number | boolean | null>;
}

class AuditLogsPageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 41 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class AuditLogsPageDto {
  @ApiProperty({ type: [AuditLogDto] })
  data!: AuditLogDto[];

  @ApiProperty({ type: AuditLogsPageMetaDto })
  meta!: AuditLogsPageMetaDto;
}
