import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Matches, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class NotificationListQueryDto extends PageQueryDto {
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

  @ApiPropertyOptional({ enum: ['createdAt'], description: 'Notifications are sorted by creation time' })
  @IsOptional()
  @IsIn(['createdAt'])
  override sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override order: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ type: Boolean, description: 'When true, return only unread notifications', default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  unreadOnly = false;
}

export class CreateNotificationDto {
  @ApiProperty({ description: 'Stable ID of the source domain event' })
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ApiProperty({ description: 'Typed domain-event name, for example booking.confirmed' })
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/)
  @MaxLength(80)
  eventType!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  message!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]*$/)
  @MaxLength(80)
  resourceType!: string;

  @ApiProperty({ description: 'Related resource identifier', maxLength: 128 })
  @IsString()
  @MaxLength(128)
  resourceId!: string;

  @ApiProperty({ description: 'Recipient user ObjectId' })
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  recipientId!: string;
}

export class NotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  resourceType!: string;

  @ApiProperty()
  resourceId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiProperty()
  isRead!: boolean;
}

export class NotificationPageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 4 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] })
  data!: NotificationDto[];

  @ApiProperty({ type: NotificationPageMetaDto })
  meta!: NotificationPageMetaDto;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  count!: number;
}
