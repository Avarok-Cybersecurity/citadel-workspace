/**
 * The type a received file's Blob carries: what its bytes are when they are a raster image,
 * otherwise what its name says. A type the browser would run or render as a document in this
 * origin (HTML, SVG, XML, script) is never given; those files are saved as plain bytes.
 */
import { getMimeType } from '@/lib/file-transfer/transfer-format';
import { sniffRaster } from './raster-sniff';

const OPAQUE: string = 'application/octet-stream';
const ACTIVE: RegExp = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;

export function blobTypeFor(bytes: Uint8Array, name: string): string {
  const raster: string | null = sniffRaster(bytes);
  if (raster !== null) return raster;
  const declared: string = getMimeType(name);
  return ACTIVE.test(declared) || declared.startsWith('image/') ? OPAQUE : declared;
}
