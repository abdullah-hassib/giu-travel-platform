import { ApiProperty, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId } from 'class-validator';
import { RegisterDto } from '../../auth/dto/auth.dto';
import { ProviderKind } from '../provider-administration.adapter';

export class CreateModeratorDto extends PickType(RegisterDto, [
  'fullName',
  'email',
  'password',
] as const) {
  @ApiProperty({ enum: ['airline_moderator', 'hotel_moderator'] })
  @IsIn(['airline_moderator', 'hotel_moderator'])
  role!: 'airline_moderator' | 'hotel_moderator';
  @ApiProperty({
    description: 'Exactly one existing provider, matching the role',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsMongoId()
  providerId!: string;
}
export class ModeratorCreatedDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['airline_moderator', 'hotel_moderator'] })
  role!: string;
  @ApiProperty({ enum: ['airline', 'hotel'] }) providerType!: ProviderKind;
  @ApiProperty() providerId!: string;
  @ApiProperty({ enum: [true] }) mustChangePassword!: boolean;
}
