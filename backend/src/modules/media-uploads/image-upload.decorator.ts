import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiPayloadTooLargeResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { IsMongoId, IsString, Matches } from 'class-validator';
import { IMAGE_ID_PATTERN, MAX_IMAGE_BYTES } from './media.service';

/** Accepts one multipart "file" field, kept in memory and capped at 5 MB (GEN-08). */
export const ImageUpload = () =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file'],
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description: 'JPG or PNG, max 5 MB',
          },
        },
      },
    }),
    ApiPayloadTooLargeResponse({ description: 'Image larger than 5 MB' }),
  );

/** Route params for /<owner>/:id/images/:imageId. */
export class ImageParamsDto {
  @ApiProperty()
  @IsMongoId()
  id!: string;

  @ApiProperty({ example: '6f1c2a9e-1b2c-4d5e-8f90-123456789abc.jpg' })
  @IsString()
  @Matches(IMAGE_ID_PATTERN, { message: 'Unknown image id' })
  imageId!: string;
}
