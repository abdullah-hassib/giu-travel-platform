import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateAirlineDto } from './create-airline.dto';

export class UpdateAirlineDto extends PartialType(
  OmitType(CreateAirlineDto, ['moderatorId'] as const),
) {}
