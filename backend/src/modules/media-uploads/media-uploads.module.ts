import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** Shared GEN-08 image storage. Import it and inject MediaService to attach images. */
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaUploadsModule {}
