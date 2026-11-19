import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAirlineDto } from './create-airline.dto';
import { BaggagePolicyDto } from './baggage-policy.dto';
import { CancellationPolicyTierDto } from './cancellation-policy-tier.dto';

export class AirlineViewDto extends CreateAirlineDto {
  @ApiProperty({
    required: true,
    description: 'Current absolute or server-stored logo URL',
  })
  logoUrl!: string;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['active', 'deactivated'] }) status!: string;
  @ApiPropertyOptional({ type: BaggagePolicyDto })
  baggagePolicy?: BaggagePolicyDto;
  @ApiProperty({ type: [CancellationPolicyTierDto] })
  cancellationPolicy!: CancellationPolicyTierDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
