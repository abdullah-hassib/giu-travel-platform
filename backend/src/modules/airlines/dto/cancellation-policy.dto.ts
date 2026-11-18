import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CancellationPolicyTierDto } from './cancellation-policy-tier.dto';

export class CancellationPolicyDto {
  @ApiProperty({
    type: [CancellationPolicyTierDto],
    example: [
      { daysBeforeDeparture: 30, refundPercentage: 80 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
      { daysBeforeDeparture: 0, refundPercentage: 0 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CancellationPolicyTierDto)
  tiers!: CancellationPolicyTierDto[];
}
