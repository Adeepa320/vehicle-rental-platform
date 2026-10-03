import {
  ACCEPTED_PHOTO_FORMATS,
  MIN_PHOTO_HEIGHT,
  MIN_PHOTO_WIDTH,
  PHOTO_VARIANTS,
  type AcceptedPhotoFormat,
  type PhotoVariant,
} from '@vrp/contracts';
import sharp from 'sharp';

import { ApiException } from '../../common/errors/api.exception';

/** Pixel budget for decoding: rejects image bombs before they allocate memory. */
const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;

export interface ProcessedImage {
  format: AcceptedPhotoFormat;
  mimeType: `image/${AcceptedPhotoFormat}`;
  /** Dimensions after EXIF orientation is applied. */
  width: number;
  height: number;
  /** WebP variants, metadata-free, longest side capped per `PHOTO_VARIANTS`. */
  variants: Record<PhotoVariant, Buffer>;
}

function invalid(message: string, status: 400 | 415 = 400): ApiException {
  return new ApiException(
    status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'VALIDATION_ERROR',
    message,
    status,
    [{ field: 'file', issue: message }],
  );
}

/**
 * Validates an uploaded image by its bytes (never by extension or declared
 * MIME type), normalises orientation, strips all metadata (EXIF/GPS, ICC,
 * XMP) and produces the public WebP variants (TECH_DECISIONS D43).
 */
export async function processVehiclePhoto(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw invalid('the uploaded file is empty');

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    }).metadata();
  } catch {
    throw invalid('the file is not a supported image (JPEG, PNG or WebP)', 415);
  }
  const format = metadata.format as AcceptedPhotoFormat | undefined;
  if (!format || !(ACCEPTED_PHOTO_FORMATS as readonly string[]).includes(format)) {
    throw invalid(
      `unsupported image format${format ? ` "${format}"` : ''}; use JPEG, PNG or WebP`,
      415,
    );
  }
  if ((metadata.pages ?? 1) > 1) throw invalid('animated images are not supported');
  if (!metadata.width || !metadata.height) throw invalid('could not read the image dimensions');

  // EXIF orientation 5–8 swap the visual axes; `rotate()` applies it and drops the tag.
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (width < MIN_PHOTO_WIDTH || height < MIN_PHOTO_HEIGHT) {
    throw invalid(`the image must be at least ${MIN_PHOTO_WIDTH}×${MIN_PHOTO_HEIGHT} pixels`);
  }

  const variants = {} as Record<PhotoVariant, Buffer>;
  for (const [name, size] of Object.entries(PHOTO_VARIANTS) as [PhotoVariant, number][]) {
    try {
      variants[name] = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw invalid('the image could not be processed; it may be corrupt', 415);
    }
  }

  return { format, mimeType: `image/${format}`, width, height, variants };
}
