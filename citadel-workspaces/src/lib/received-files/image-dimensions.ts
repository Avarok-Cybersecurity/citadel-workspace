/**
 * A raster image's width and height, read from its header before anything decodes it.
 *
 * Decoding is where a hostile image does its harm: a few kilobytes can declare a 60000 x 60000
 * canvas, and createImageBitmap or <img> would try to allocate it. The header says how big the
 * image claims to be; anything over the limits is refused before the browser sees it. Pure.
 */
import type { RasterMime } from './raster-sniff';

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

const be16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1];
const le16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8);
const be32 = (b: Uint8Array, at: number): number => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const le24 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const le32 = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
/** A signed 32-bit little-endian value's magnitude (a BMP's height is negative when top-down). */
const leAbs32 = (b: Uint8Array, at: number): number => Math.abs(le32(b, at) | 0);

function png(b: Uint8Array): Dimensions | null {
  return b.length >= 24 ? { width: be32(b, 16), height: be32(b, 20) } : null;
}

function gif(b: Uint8Array): Dimensions | null {
  return b.length >= 10 ? { width: le16(b, 6), height: le16(b, 8) } : null;
}

/** The first start-of-frame marker's size; SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC). */
function jpeg(b: Uint8Array): Dimensions | null {
  let at: number = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker: number = b[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    const isFrame: boolean = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { width: be16(b, at + 7), height: be16(b, at + 5) };
    at += 2 + be16(b, at + 2);
  }
  return null;
}

function webp(b: Uint8Array): Dimensions | null {
  if (b.length < 30) return null;
  const chunk: string = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === 'VP8X') return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  if (chunk === 'VP8 ') return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits: number = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** AVIF's image spatial extents box ('ispe'): version/flags, then width and height. */
function avif(b: Uint8Array): Dimensions | null {
  for (let at: number = 4; at + 16 <= b.length && at < 4096; at++) {
    if (b[at] === 0x69 && b[at + 1] === 0x73 && b[at + 2] === 0x70 && b[at + 3] === 0x65) {
      return { width: be32(b, at + 8), height: be32(b, at + 12) };
    }
  }
  return null;
}

/** A BMP's DIB header: the 12-byte OS/2 core header has 16-bit sizes, every later one 32-bit. */
function dib(b: Uint8Array, at: number): Dimensions | null {
  if (at + 12 > b.length) return null;
  if (le32(b, at) === 12) return { width: le16(b, at + 4), height: le16(b, at + 6) };
  return { width: leAbs32(b, at + 4), height: leAbs32(b, at + 8) };
}

function bmp(b: Uint8Array): Dimensions | null {
  return dib(b, 14);
}

const ICO_MAX_ENTRIES: number = 64;

/** An icon entry's image: a PNG, or a BMP without its file header whose height counts its mask. */
function icoImage(b: Uint8Array, offset: number): Dimensions | null {
  if (b[offset] === 0x89) return png(b.subarray(offset));
  const size: Dimensions | null = dib(b, offset);
  return size === null ? null : { width: size.width, height: Math.ceil(size.height / 2) };
}

/**
 * An icon holds several images and the browser picks one. Each entry's directory size is a byte
 * (0 means 256), but the image it points at declares its own, and that is what gets decoded: the
 * largest size anything in the file declares is the one checked, and an unreadable entry fails it.
 */
function ico(b: Uint8Array): Dimensions | null {
  const count: number = Math.min(le16(b, 4), ICO_MAX_ENTRIES);
  let width: number = 0;
  let height: number = 0;
  for (let i: number = 0; i < count; i++) {
    const entry: number = 6 + i * 16;
    if (entry + 16 > b.length) return null;
    const image: Dimensions | null = icoImage(b, le32(b, entry + 12));
    if (image === null) return null;
    width = Math.max(width, b[entry] || 256, image.width);
    height = Math.max(height, b[entry + 1] || 256, image.height);
  }
  return count > 0 ? { width, height } : null;
}

const READERS: Record<RasterMime, (b: Uint8Array) => Dimensions | null> = {
  'image/png': png, 'image/gif': gif, 'image/jpeg': jpeg, 'image/webp': webp, 'image/avif': avif,
  'image/bmp': bmp, 'image/x-icon': ico,
};

export function headerDimensions(bytes: Uint8Array, mime: RasterMime): Dimensions | null {
  return READERS[mime](bytes);
}
