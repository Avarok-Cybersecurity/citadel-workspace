/**
 * Loads the photo decoder's glue (its own chunk, imported only inside the worker) and its binary
 * from the stable URL, compiled while it streams, and adapts its one export to decode-photo.ts.
 */
import { PHOTO_DECODE_WASM_URL } from './asset-urls';
import type { DecodePorts, ModuleAnswer, PhotoLimits } from './decode-photo';

export type PhotoGlue = typeof import('../../../vendor/photo/photo_decode.js');

export async function loadPhotoModule(): Promise<DecodePorts['module']> {
  const glue: PhotoGlue = await import('../../../vendor/photo/photo_decode.js');
  await glue.default({ module_or_path: PHOTO_DECODE_WASM_URL });
  return (bytes: Uint8Array, limits: PhotoLimits, pixels: boolean): ModuleAnswer =>
    glue.decode_photo(bytes, limits.maxPixels, limits.maxEdge, pixels);
}
