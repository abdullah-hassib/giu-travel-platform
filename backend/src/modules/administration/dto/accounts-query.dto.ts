import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthUserDto } from '../../auth/dto/auth.dto';
import { USER_ROLES, USER_STATUSES, UserRole, UserStatus } from '../../users/schemas/user.schema';

export class AccountsQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: Math.floor(Number.MAX_SAFE_INTEGER / 10), default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Math.floor(Number.MAX_SAFE_INTEGER / 10))
  page = 1;

  @ApiPropertyOptional({ description: 'Literal case-insensitive substring of name or email' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: [...USER_ROLES] })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ enum: [...USER_STATUSES] })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;
}

export class AdminAccountDto extends AuthUserDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Registration timestamp; null for records lacking a persisted timestamp' })
  createdAt!: Date | null;
}

class AccountsPageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ enum: [10] })
  limit!: number;

  @ApiProperty({ example: 13 })
  total!: number;

  @ApiProperty({ example: 2 })
  totalPages!: number;
}

export class AccountsPageDto {
  @ApiProperty({ type: [AdminAccountDto] })
  data!: AdminAccountDto[];

  @ApiProperty({ type: AccountsPageMetaDto })
  meta!: AccountsPageMetaDto;
}
