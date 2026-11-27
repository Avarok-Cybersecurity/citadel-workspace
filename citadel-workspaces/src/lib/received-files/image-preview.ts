/**
 * Which files are shown as pictures in a chat, and from which bytes. Pure.
 *
 * A file is a picture only when its bytes are a raster format the browser draws (raster-sniff.ts)
 * and its header declares a size within the limits below, or a photo format the page decodes
 * itself (lib/photo-decode), which checks the same limits before decoding; never by its name or
 * declared type, and never SVG, which is a document that can carry script. The name only decides
 * whether reading the bytes is worth trying.
 */
import { sniffPhoto, sniffRaster, type PhotoMime, type RasterMime } from './raster-sniff';
import { headerDimensions, type Dimensions } from './image-dimensions';

/** The largest file read into the page to be shown as a picture. */
export const MAX_PREVIEW_BYTES: bigint = 25n * 1024n * 1024n;
/**
 * A camera RAW file's limit instead: a 24-megapixel RAW is 25-60 MB, and its JPEG preview can sit
 * anywhere in it, so the whole file is read (the preview itself is still held to the pixel limits).
 */
export const MAX_RAW_PREVIEW_BYTES: bigint = 100n * 1024n * 1024n;
/** The largest picture decoded, in pixels (a 40 MP photo is about 7300 x 5500). */
export const MAX_PREVIEW_PIXELS: number = 40_000_000;
/** The longest edge decoded, whatever the pixel count. */
export const MAX_PREVIEW_EDGE: number = 16_384;
/** The most a sender's inline thumbnail (a data URL in the offer) may be. */
export const MAX_THUMBNAIL_CHARS: number = 256 * 1024;

const RAW_NAME: RegExp = /\.(dng|cr2|nef|nrw|arw|srf|sr2|pef|srw)$/i;
const PICTURE_NAME: RegExp = /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|heif|tiff?)$/i;
const PICTURE_TYPE: RegExp = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|heic|heif|tiff|x-adobe-dng|x-canon-cr2|x-nikon-nef|x-sony-arw)$/i;

/** The most of a file read to show it as a picture: more for a camera RAW, by its name. */
export function previewByteLimit(name: string): bigint {
  return RAW_NAME.test(name) ? MAX_RAW_PREVIEW_BYTES : MAX_PREVIEW_BYTES;
}

/** The most picture bytes read and decoding at once: one camera RAW and one other picture. */
export const MAX_IN_FLIGHT_PREVIEW_BYTES: bigint = MAX_RAW_PREVIEW_BYTES + MAX_PREVIEW_BYTES;

/**
 * What reading `name` for a preview holds while it reads and decodes: its limit, not the size its
 * sender declared, and whether it is a RAW, of which one is read at a time.
 */
export function previewReservation(name: string): PreviewReservation {
  return { bytes: previewByteLimit(name), raw: RAW_NAME.test(name) };
}

export interface PreviewReservation {
  readonly bytes: bigint;
  readonly raw: boolean;
}

/** Whether a file is worth reading to see if it is a picture: by its name or declared type. */
export function looksLikePicture(name: string, declaredType: string | undefined, size: number): boolean {
  const named: boolean = PICTURE_NAME.test(name) || RAW_NAME.test(name) || PICTURE_TYPE.test(declaredType ?? '');
  return named && size > 0 && BigInt(size) <= previewByteLimit(name);
}

export interface Picture {
  readonly mime: RasterMime;
  readonly size: Dimensions;
}

/** What the bytes are as a picture, or why they are not shown as one. */
export function pictureOf(bytes: Uint8Array): Picture | string {
  const mime: RasterMime | null = sniffRaster(bytes);
  if (mime === null) return 'not a PNG, JPEG, GIF, WebP, AVIF, BMP, icon, HEIC, TIFF or camera RAW image';
  const size: Dimensions | null = headerDimensions(bytes, mime);
  if (size === null || size.width <= 0 || size.height <= 0) return 'its size cannot be read';
  if (size.width > MAX_PREVIEW_EDGE || size.height > MAX_PREVIEW_EDGE || size.width * size.height > MAX_PREVIEW_PIXELS) {
    return `at ${size.width} x ${size.height} it is too large to show`;
  }
  return { mime, size };
}

/** Where a picture's pixels come from: the browser, or the page's photo decoder. */
export type PictureSource =
  | { readonly kind: 'native'; readonly picture: Picture }
  | { readonly kind: 'decode'; readonly mime: PhotoMime };

/** What the bytes are as a picture to show, or why they are not one. */
export function pictureSourceOf(bytes: Uint8Array): PictureSource | string {
  const photo: PhotoMime | null = sniffPhoto(bytes);
  if (photo !== null) return { kind: 'decode', mime: photo };
  const picture: Picture | string = pictureOf(bytes);
  return typeof picture === 'string' ? picture : { kind: 'native', picture };
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
