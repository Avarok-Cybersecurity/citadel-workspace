/**
 * The worker's browser ports for decode-photo.ts: the browser's own decoder and an
 * OffscreenCanvas that turns pixels (or a JPEG that needs turning upright) into an encoded Blob.
 * An opaque photo is encoded as JPEG, which is a fraction of a PNG's size for a photograph; one
 * with transparency as PNG.
 */
import type { DecodePorts } from './decode-photo';
import { oriented, type Oriented } from './orientation';

const JPEG_QUALITY: number = 0.92;

async function drawsNatively(blob: Blob): Promise<boolean> {
  try {
    const bitmap: ImageBitmap = await createImageBitmap(blob);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

function blobOf(canvas: OffscreenCanvas, opaque: boolean): Promise<Blob> {
  return canvas.convertToBlob(opaque ? { type: 'image/jpeg', quality: JPEG_QUALITY } : { type: 'image/png' });
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx: OffscreenCanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) throw new Error('this browser gives a worker no 2D canvas');
  return ctx;
}

/** `source` (width x height) drawn upright by `orientation`, encoded. */
async function encode(source: CanvasImageSource, width: number, height: number, orientation: number, opaque: boolean): Promise<Blob> {
  const turned: Oriented = oriented(orientation, width, height);
  const canvas: OffscreenCanvas = new OffscreenCanvas(turned.width, turned.height);
  const ctx: OffscreenCanvasRenderingContext2D = context(canvas);
  ctx.transform(...turned.matrix);
  ctx.drawImage(source, 0, 0);
  return blobOf(canvas, opaque);
}

async function encodeRgba(rgba: Uint8Array, width: number, height: number, orientation: number, opaque: boolean): Promise<Blob> {
  // The module's pixels arrive in a fresh ArrayBuffer (wasm-bindgen copies them out), never a shared one.
  const pixels: ImageData = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height);
  const flat: OffscreenCanvas = new OffscreenCanvas(width, height);
  context(flat).putImageData(pixels, 0, 0);
  if (orientation === 1) return blobOf(flat, opaque);
  return encode(flat, width, height, orientation, opaque);
}

async function encodeJpeg(jpeg: Uint8Array, width: number, height: number, orientation: number): Promise<Blob> {
  const original: Blob = new Blob([jpeg.slice().buffer], { type: 'image/jpeg' });
  if (orientation === 1) return original;
  const bitmap: ImageBitmap = await createImageBitmap(original);
  try {
    return await encode(bitmap, width, height, orientation, true);
  } finally {
    bitmap.close();
  }
}

export const canvasPorts: Omit<DecodePorts, 'module'> = { drawsNatively, encodeRgba, encodeJpeg };
