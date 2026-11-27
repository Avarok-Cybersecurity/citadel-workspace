/**
 * A file's bytes as a picture to draw: the browser's own formats as they are, the photo formats
 * through the page's decoder (lib/photo-decode). Two Blobs come back: what is drawn, and the
 * original, typed by what its bytes are, which is what Download saves. Pure over the decoder.
 */
import type { Dimensions } from './image-dimensions';
import { pictureSourceOf, type PictureSource } from './image-preview';
import type { PhotoMime } from './raster-sniff';
import type { PhotoAnswer } from '@/lib/photo-decode/photo-decoder';
import { previewRefusalClause, type PhotoRefusal } from '@/lib/photo-decode/photo-refusal';

export type DecodePhoto = (bytes: Uint8Array, mime: PhotoMime) => Promise<PhotoAnswer>;

export interface DrawnPicture {
  /** What an <img> draws: the original, or the decoder's re-encoding of it. */
  readonly display: Blob;
  /** The bytes as received, typed by what they are. */
  readonly original: Blob;
  /** The size drawn, upright. */
  readonly size: Dimensions;
}

/** A photo the decoder would not draw, with its bytes typed by what they are: still a file to save. */
export interface RefusedPicture {
  readonly refusal: PhotoRefusal;
  readonly original: Blob;
}

/**
 * The picture to draw from `bytes`; or the decoder's refusal, for the surface to word with its
 * own way on; or, when the bytes are no picture format at all, why, as a clause.
 */
export async function drawnOrRefused(bytes: Uint8Array, decode: DecodePhoto): Promise<DrawnPicture | RefusedPicture | string> {
  const source: PictureSource | string = pictureSourceOf(bytes);
  if (typeof source === 'string') return source;
  if (source.kind === 'native') {
    const original: Blob = new Blob([bytes.slice().buffer], { type: source.picture.mime });
    return { display: original, original, size: source.picture.size };
  }
  const answer: PhotoAnswer = await decode(bytes, source.mime);
  const original: Blob = new Blob([bytes.slice().buffer], { type: source.mime });
  if (answer.kind !== 'decoded') return { refusal: answer, original };
  return { display: answer.blob ?? original, original, size: { width: answer.width, height: answer.height } };
}

/** The picture to draw from `bytes` in a chat, or why there is none, as a clause. */
export async function drawnPictureOf(bytes: Uint8Array, decode: DecodePhoto): Promise<DrawnPicture | string> {
  const drawn: DrawnPicture | RefusedPicture | string = await drawnOrRefused(bytes, decode);
  return typeof drawn === 'string' || 'display' in drawn ? drawn : previewRefusalClause(drawn.refusal);
}
