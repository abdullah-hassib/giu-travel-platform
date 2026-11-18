import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MediaService } from './media.service';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':imageId')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'GEN-08: serve an uploaded image by its URL' })
  @ApiOkResponse({ description: 'The JPG or PNG image' })
  @ApiNotFoundResponse({ description: 'Image does not exist' })
  serve(@Param('imageId') imageId: string): Promise<StreamableFile> {
    return this.media.open(imageId);
  }
}
