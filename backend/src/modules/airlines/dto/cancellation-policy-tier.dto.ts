import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class CancellationPolicyTierDto {
  @ApiProperty({
    example: 30,
    minimum: 0,
    description: 'Minimum number of days remaining before departure',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  daysBeforeDeparture!: number;

  @ApiProperty({ example: 80, minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  refundPercentage!: number;
}
