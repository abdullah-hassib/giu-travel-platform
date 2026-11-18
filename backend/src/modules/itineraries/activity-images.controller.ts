import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Req,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { Authenticated } from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { AuthenticatedRequest } from '../auth/security/session.guard';
import {
  ImageParamsDto,
  ImageUpload,
} from '../media-uploads/image-upload.decorator';
import { UploadedImage } from '../media-uploads/media.service';
import { ItineraryViewDto } from './dto/itinerary-view.dto';
import { ItinerariesService } from './itineraries.service';

class ActivityImageBodyDto {}
export class PublicActivityImageParamsDto extends ImageParamsDto {
  @ApiProperty() @IsMongoId() itineraryId!: string;
}

@ApiTags('Itinerary activity images')
@ApiBadRequestResponse({
  description: 'Invalid activity/image ID, image content or unsupported fields',
})
@ApiNotFoundResponse({
  description: 'Activity/image missing or inaccessible in this itinerary',
})
@Controller()
export class ActivityImagesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post('activities/:id/images')
  @Authenticated('traveler')
  @ImageUpload()
  @ApiOperation({
    summary:
      'ITN-12/GEN-08: attach a JPG/PNG image to your activity (5 MB, five images maximum)',
  })
  @ApiCreatedResponse({ type: ItineraryViewDto })
  @ApiConflictResponse({
    description: 'Five-image limit or concurrent itinerary modification',
  })
  upload(
    @Body() _body: ActivityImageBodyDto,
    @Req() request: AuthenticatedRequest,
    @Param() params: IdParamDto,
    @UploadedFile() file?: UploadedImage,
  ) {
    return this.itineraries.addActivityImage(
      request.authUser.id,
      params.id,
      file,
    );
  }

  @Delete('activities/:id/images/:imageId')
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'ITN-12: remove your activity image; existing clones retain their own copy',
  })
  @ApiOkResponse({ type: ItineraryViewDto })
  @ApiConflictResponse({
    description: 'Concurrent itinerary modification; reload and retry',
  })
  remove(
    @Req() request: AuthenticatedRequest,
    @Param() params: ImageParamsDto,
  ) {
    return this.itineraries.removeActivityImage(
      request.authUser.id,
      params.id,
      params.imageId,
    );
  }

  @Get('activities/:id/images/:imageId')
  @Authenticated('traveler')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOperation({
    summary: 'Read your activity image with itinerary ownership checks',
  })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  ownImage(
    @Req() request: AuthenticatedRequest,
    @Param() params: ImageParamsDto,
  ) {
    return this.itineraries.openActivityImage(
      request.authUser.id,
      params.id,
      params.imageId,
    );
  }

  @Get('itineraries/public/:itineraryId/activities/:id/images/:imageId')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOperation({
    summary:
      'Read an image only while its itinerary and author are publicly visible',
  })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  publicImage(@Param() params: PublicActivityImageParamsDto) {
    return this.itineraries.openPublicActivityImage(
      params.itineraryId,
      params.id,
      params.imageId,
    );
  }
}
