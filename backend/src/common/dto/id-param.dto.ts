import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/** Route params for /resource/:id. */
export class IdParamDto {
  @ApiProperty()
  @IsMongoId()
  id!: string;
}
