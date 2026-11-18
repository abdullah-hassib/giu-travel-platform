import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  IMAGE_ID_PATTERN,
  MediaService,
  UploadedImage,
} from '../media-uploads/media.service';

/** Reuses MK's limits/content validation in a directory his public route cannot serve. */
@Injectable()
export class ActivityMediaStorage {
  private readonly directory: string;
  private readonly media: MediaService;

  constructor(config: ConfigService) {
    this.directory = join(
      resolve(config.get<string>('MEDIA_UPLOAD_DIR') ?? 'uploads'),
      'activities',
    );
    this.media = new MediaService(
      new ConfigService({ MEDIA_UPLOAD_DIR: this.directory }),
    );
  }
  save(file: UploadedImage | undefined) {
    return this.media.saveImage(file);
  }
  open(id: string) {
    return this.media.open(id);
  }
  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.media.removeImage(id)));
  }
  async copy(id: string) {
    if (!IMAGE_ID_PATTERN.test(id))
      throw new ServiceUnavailableException(
        'Activity image unavailable; retry cloning',
      );
    let buffer: Buffer;
    try {
      buffer = await readFile(join(this.directory, id));
    } catch {
      throw new ServiceUnavailableException(
        'Activity image unavailable; retry cloning',
      );
    }
    return this.save({ buffer, size: buffer.length });
  }
}

export function activityImageUrl(
  activityId: string,
  imageId: string,
  publicItineraryId?: string,
): string {
  return publicItineraryId
    ? `/api/itineraries/public/${publicItineraryId}/activities/${activityId}/images/${imageId}`
    : `/api/activities/${activityId}/images/${imageId}`;
}
