import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StoredImage } from './stored-image.schema';

/** GEN-08 limits, shared by posts, hotels and itinerary activities. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_ITEM = 5;
export const IMAGE_ID_PATTERN = /^[0-9a-f-]{36}\.(jpg|png)$/;

/** The fields of a multer memory-storage upload that this service needs. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

@Injectable()
export class MediaService {
  private readonly directory: string;

  constructor(config: ConfigService) {
    this.directory = resolve(
      config.get<string>('MEDIA_UPLOAD_DIR') ?? 'uploads',
    );
  }

  /** Validates the real file content (not the name or client mimetype) and stores it. */
  async saveImage(file: UploadedImage | undefined): Promise<StoredImage> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Attach a JPG or PNG image in the "file" field',
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Images must be 5 MB or smaller');
    }
    const extension = imageExtension(file.buffer);
    if (!extension) {
      throw new BadRequestException('Only JPG and PNG images are accepted');
    }
    const id = `${randomUUID()}.${extension}`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, id), file.buffer);
    return { id, url: `/api/media/${id}` };
  }

  /** Best effort: a missing file is already the desired end state. */
  async removeImage(id: string): Promise<void> {
    if (!IMAGE_ID_PATTERN.test(id)) return;
    await unlink(join(this.directory, id)).catch(() => undefined);
  }

  async open(id: string): Promise<StreamableFile> {
    if (!IMAGE_ID_PATTERN.test(id))
      throw new NotFoundException('Image not found');
    const path = join(this.directory, id);
    try {
      await access(path);
    } catch {
      throw new NotFoundException('Image not found');
    }
    return new StreamableFile(createReadStream(path), {
      type: id.endsWith('.png') ? 'image/png' : 'image/jpeg',
    });
  }
}

function imageExtension(bytes: Buffer): 'jpg' | 'png' | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpg';
  }
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    return 'png';
  return null;
}
