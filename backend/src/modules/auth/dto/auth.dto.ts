import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { USER_ROLES, USER_STATUSES, UserRole, UserStatus } from '../../users/schemas/user.schema';
import { CURRENCIES } from '../../reference-data/official-reference';

export class AuthUserDto {
  @ApiPropertyOptional({ default: false, description: 'Restricted session: identity, refresh, logout and password change only' })
  mustChangePassword?: boolean;
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id!: string;

  @ApiProperty({ example: 'traveler@example.com' })
  email!: string;

  @ApiProperty({ example: 'Traveler Name' })
  fullName!: string;

  @ApiProperty({ type: String, nullable: true, example: '+201001234567' })
  phone!: string | null;

  @ApiProperty({ type: String, enum: CURRENCIES, nullable: true, description: 'Null until the user selects a supported currency' })
  preferredCurrency!: string | null;

  @ApiProperty({ enum: [...USER_ROLES], isArray: true })
  roles!: UserRole[];

  @ApiProperty({ enum: [...USER_STATUSES] })
  status!: UserStatus;
}

export class AuthResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'traveler@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, writeOnly: true, description: 'At least one letter and one digit (ACC-01)' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*\p{L})(?=.*\d)[\s\S]*$/u, { message: 'password must contain at least one letter and one digit' })
  password!: string;

  @ApiProperty({ example: true, description: 'Accept both terms and privacy policy (ACC-01)' })
  @IsBoolean()
  @Equals(true, { message: 'Terms and privacy policy must be accepted' })
  termsAccepted!: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'traveler@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, writeOnly: true, description: 'At least one letter and one digit (ACC-08)' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*\p{L})(?=.*\d)[\s\S]*$/u, { message: 'newPassword must contain at least one letter and one digit' })
  newPassword!: string;
}
