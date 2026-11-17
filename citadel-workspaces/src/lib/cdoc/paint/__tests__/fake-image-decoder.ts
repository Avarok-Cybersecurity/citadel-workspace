/**
 * Stands in for createImageBitmap, which node and jsdom do not have (mocked for that reason
 * alone): it accepts bytes whose signature is the declared type's and reads their pixel size
 * from the header, and rejects anything else, as the browser does. Each decode is counted, so
 * tests can see an id decoded once.
 */
import type { DecodedImage } from '../image-cache';

const PNG: readonly number[] = [0x89, 0x50, 0x4e, 0x47];
const JPEG: readonly number[] = [0xff, 0xd8, 0xff];
const starts = (bytes: Uint8Array, sig: readonly number[]): boolean => sig.every((b: number, i: number): boolean => bytes[i] === b);

function jpegSize(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  let at: number = 2;
  while (at + 9 < bytes.length) {
    const marker: number = bytes[at + 1];
    const length: number = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xc2) return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] };
    at += 2 + length;
  }
  throw new Error('InvalidStateError: the source image could not be decoded');
}

export interface FakeDecoder {
  readonly decode: (bytes: Uint8Array, mime: string) => Promise<DecodedImage>;
  /** MIME types decoded, in order. */
  readonly decoded: string[];
  /** Images closed (evicted), by MIME type. */
  readonly closed: string[];
}

export function fakeImageDecoder(): FakeDecoder {
  const decoded: string[] = [];
  const closed: string[] = [];
  const decode = async (bytes: Uint8Array, mime: string): Promise<DecodedImage> => {
    let size: { readonly width: number; readonly height: number };
    if (mime === 'image/png' && starts(bytes, PNG)) {
      const v: DataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      size = { width: v.getUint32(16), height: v.getUint32(20) };
    } else if (mime === 'image/jpeg' && starts(bytes, JPEG)) size = jpegSize(bytes);
    else throw new Error('InvalidStateError: the source image could not be decoded');
    decoded.push(mime);
    return { source: { image: mime } as unknown as CanvasImageSource, ...size, close: (): void => { closed.push(mime); } };
  };
  return { decode, decoded, closed };
}
