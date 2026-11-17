/**
 * What raster image a file's bytes are, by their magic numbers alone: never by its name, its
 * declared type, or a peer's say-so. Only these five decode as a bitmap; anything else (SVG,
 * HTML, a renamed executable) is not an image here, whatever it calls itself.
 */
export type RasterMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif';

function startsWith(bytes: Uint8Array, at: number, ascii: string): boolean {
  if (bytes.length < at + ascii.length) return false;
  for (let i: number = 0; i < ascii.length; i++) {
    if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffRaster(bytes: Uint8Array): RasterMime | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b: number, i: number): boolean => bytes[i] === b)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (startsWith(bytes, 0, 'GIF87a') || startsWith(bytes, 0, 'GIF89a')) return 'image/gif';
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'image/webp';
  if (startsWith(bytes, 4, 'ftyp') && (startsWith(bytes, 8, 'avif') || startsWith(bytes, 8, 'avis'))) return 'image/avif';
  return null;
}
