import type { AcceptedDocumentMimeType } from '@vrp/contracts';
import sharp from 'sharp';

import { ApiException } from '../../common/errors/api.exception';

export interface SniffedDocument {
  mimeType: AcceptedDocumentMimeType;
  extension: 'pdf' | 'jpg' | 'png';
}

/** Pixel budget for decoding image documents: rejects image bombs before they allocate memory. */
const MAX_INPUT_PIXELS = 50_000_000;

function unsupported(message: string): ApiException {
  return new ApiException('UNSUPPORTED_MEDIA_TYPE', message, 415, [
    { field: 'file', issue: message },
  ]);
}

/**
 * Decides the document type from the **bytes**, never from the declared
 * content type or the file name (TECH_DECISIONS D61): `%PDF-` for PDF, the
 * JPEG and PNG signatures for images, which sharp must also be able to decode
 * (defeats polyglot and mislabelled files). Everything else — SVG, HTML,
 * executables, archives, animated images — is refused with 415.
 */
export async function sniffDocument(input: Buffer): Promise<SniffedDocument> {
  if (input.length === 0) {
    throw new ApiException('VALIDATION_ERROR', 'the uploaded file is empty', 400, [
      { field: 'file', issue: 'the uploaded file is empty' },
    ]);
  }
  if (input.length >= 5 && input.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  const isJpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const isPng =
    input.length >= 8 &&
    input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) {
    throw unsupported('the file is not a PDF, JPEG or PNG document');
  }
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    }).metadata();
  } catch {
    throw unsupported('the image could not be decoded; it may be corrupt');
  }
  if ((isJpeg && metadata.format !== 'jpeg') || (isPng && metadata.format !== 'png')) {
    throw unsupported('the file content does not match its image signature');
  }
  if ((metadata.pages ?? 1) > 1) throw unsupported('animated images are not accepted');
  return isJpeg
    ? { mimeType: 'image/jpeg', extension: 'jpg' }
    : { mimeType: 'image/png', extension: 'png' };
}
