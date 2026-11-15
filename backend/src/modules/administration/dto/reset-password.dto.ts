import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { RegisterDto } from '../../auth/dto/auth.dto';

export class ResetPasswordDto extends PickType(RegisterDto, ['password'] as const) {}

export class AccountIdParamDto {
  @ApiProperty({ description: 'Target traveler or moderator ObjectId' })
  @IsMongoId()
  id!: string;
}
