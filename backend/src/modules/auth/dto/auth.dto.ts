import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

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

  // Provisional pending official Excel password acceptance criteria.
  @ApiProperty({ minLength: 8, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
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

  @ApiProperty({ minLength: 8, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
