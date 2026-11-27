/**
 * What the page and the photo decoder's worker say to each other. One request per photo: its
 * bytes (transferred, not copied), its sniffed type and the limits; one answer back. Pure.
 */
import type { PhotoMime } from '@/lib/received-files/raster-sniff';
import type { DecodedPhoto, PhotoLimits } from './decode-photo';
import { isPhotoRefusal, type PhotoRefusal } from './photo-refusal';

export interface PhotoRequest {
  readonly id: number;
  readonly bytes: ArrayBuffer;
  readonly mime: PhotoMime;
  readonly limits: PhotoLimits;
}

export interface PhotoResponse {
  readonly id: number;
  readonly answer: DecodedPhoto | PhotoRefusal;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function isPhotoRequest(v: unknown): v is PhotoRequest {
  return isObject(v) && typeof v.id === 'number' && v.bytes instanceof ArrayBuffer
    && (v.mime === 'image/heic' || v.mime === 'image/tiff')
    && isObject(v.limits) && typeof v.limits.maxPixels === 'number' && typeof v.limits.maxEdge === 'number';
}

function isDecodedPhoto(v: unknown): v is DecodedPhoto {
  return isObject(v) && v.kind === 'decoded' && (v.blob === null || v.blob instanceof Blob)
    && typeof v.width === 'number' && typeof v.height === 'number';
}

export function isPhotoResponse(v: unknown): v is PhotoResponse {
  return isObject(v) && typeof v.id === 'number' && (isDecodedPhoto(v.answer) || isPhotoRefusal(v.answer));
}
