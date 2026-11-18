import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import { IsCalendarDate } from '../../../common/dto/page-number.dto';
import { AccountsPageDto, AccountsQueryDto } from './accounts-query.dto';

export const ACCOUNT_HISTORY_ACTIONS = [
  'account.password_reset',
  'moderator.created',
  'account.suspended',
  'account.reactivated',
] as const;
export const DOMAIN_HISTORY_ACTIONS = [
  'hotel.deactivated',
  'hotel.reactivated',
  'moderation.report_dismissed',
  'moderation.content_hidden',
  'moderation.content_deleted',
] as const;
export const ADMIN_HISTORY_ACTIONS = [
  ...ACCOUNT_HISTORY_ACTIONS,
  ...DOMAIN_HISTORY_ACTIONS,
] as const;

export class AdminHistoryQueryDto extends PickType(AccountsQueryDto, [
  'page',
] as const) {
  @ApiPropertyOptional({ enum: ADMIN_HISTORY_ACTIONS })
  @IsOptional()
  @IsIn(ADMIN_HISTORY_ACTIONS)
  action?: (typeof ADMIN_HISTORY_ACTIONS)[number];
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsMongoId()
  actorId?: string;
  @ApiPropertyOptional({ description: 'Inclusive UTC action date, YYYY-MM-DD' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;
  @ApiPropertyOptional({ description: 'Inclusive UTC action date, YYYY-MM-DD' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
class AdminHistoryTargetDto {
  @ApiProperty({
    enum: [
      'account',
      'hotel',
      'report',
      'post',
      'comment',
      'review',
      'itinerary',
    ],
  })
  type!: string;
  @ApiProperty() id!: string;
}
export class AdminHistoryViewDto {
  @ApiProperty({ description: 'Stable committed event ID' }) id!: string;
  @ApiProperty({ enum: ADMIN_HISTORY_ACTIONS }) action!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty() correlationId!: string;
  @ApiProperty({ type: AdminHistoryTargetDto }) target!: AdminHistoryTargetDto;
  @ApiProperty({ enum: ['committed'] }) outcome!: 'committed';
  @ApiProperty({
    enum: ['pending', 'delivered'],
    description:
      'Separate consumer acknowledgment; pending does not undo the committed action',
  })
  deliveryStatus!: 'pending' | 'delivered';
}
export class AdminHistoryPageDto extends OmitType(AccountsPageDto, [
  'data',
] as const) {
  @ApiProperty({ type: [AdminHistoryViewDto] }) data!: AdminHistoryViewDto[];
}
