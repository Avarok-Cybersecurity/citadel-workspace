/**
 * Which files are shown as pictures in a chat, and from which bytes. Pure.
 *
 * A file is a picture only when its bytes are one of five raster formats (raster-sniff.ts) and
 * its header declares a size within the limits below; never by its name or declared type, and
 * never SVG, which is a document that can carry script. The name only decides whether reading
 * the bytes is worth trying.
 */
import { sniffRaster, type RasterMime } from './raster-sniff';
import { headerDimensions, type Dimensions } from './image-dimensions';

/** The largest file read into the page to be shown as a picture. */
export const MAX_PREVIEW_BYTES: bigint = 25n * 1024n * 1024n;
/** The largest picture decoded, in pixels (a 40 MP photo is about 7300 x 5500). */
export const MAX_PREVIEW_PIXELS: number = 40_000_000;
/** The longest edge decoded, whatever the pixel count. */
export const MAX_PREVIEW_EDGE: number = 16_384;
/** The most a sender's inline thumbnail (a data URL in the offer) may be. */
export const MAX_THUMBNAIL_CHARS: number = 256 * 1024;

const PICTURE_NAME: RegExp = /\.(png|jpe?g|gif|webp|avif)$/i;
const PICTURE_TYPE: RegExp = /^image\/(png|jpeg|gif|webp|avif)$/i;

/** Whether a file is worth reading to see if it is a picture: by its name or declared type. */
export function looksLikePicture(name: string, declaredType: string | undefined, size: number): boolean {
  const named: boolean = PICTURE_NAME.test(name) || PICTURE_TYPE.test(declaredType ?? '');
  return named && size > 0 && BigInt(size) <= MAX_PREVIEW_BYTES;
}

export interface Picture {
  readonly mime: RasterMime;
  readonly size: Dimensions;
}

/** What the bytes are as a picture, or why they are not shown as one. */
export function pictureOf(bytes: Uint8Array): Picture | string {
  const mime: RasterMime | null = sniffRaster(bytes);
  if (mime === null) return 'not a PNG, JPEG, GIF, WebP or AVIF image';
  const size: Dimensions | null = headerDimensions(bytes, mime);
  if (size === null || size.width <= 0 || size.height <= 0) return 'its size cannot be read';
  if (size.width > MAX_PREVIEW_EDGE || size.height > MAX_PREVIEW_EDGE || size.width * size.height > MAX_PREVIEW_PIXELS) {
    return `at ${size.width} x ${size.height} it is too large to show`;
  }
  return { mime, size };
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    const raw: string = atob(text);
    const out: Uint8Array = new Uint8Array(raw.length);
    for (let i: number = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const THUMBNAIL: RegExp = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * The sender's thumbnail, when it is an inline raster picture within the limits; else null.
 * It arrives in the peer's offer, so it could be any string: a remote URL (a tracking pixel
 * the moment the chat renders), an SVG, or a huge image. Only a data URL whose bytes sniff
 * as the raster type it declares is drawn.
 */
export function safeThumbnail(src: string | undefined): string | null {
  if (src === undefined || src.length > MAX_THUMBNAIL_CHARS) return null;
  const match: RegExpExecArray | null = THUMBNAIL.exec(src);
  if (match === null) return null;
  const bytes: Uint8Array | null = decodeBase64(match[2]);
  if (bytes === null) return null;
  const picture: Picture | string = pictureOf(bytes);
  return typeof picture !== 'string' && picture.mime === `image/${match[1].toLowerCase()}` ? src : null;
}
