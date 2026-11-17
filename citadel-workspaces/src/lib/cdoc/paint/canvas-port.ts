/**
 * What the painter needs from the canvas platform, as a port: surfaces for the glyph atlas,
 * Path2D objects for outlines, decoded images, and the context of the page it paints. The adapters
 * (dom-canvas-port.ts) are the only code that creates canvases or paths; the painter and atlas
 * only call methods on what they are handed, so they run against a recording fake in tests.
 */
import type { DecodedImage } from './image-cache';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Surface {
  readonly ctx: Ctx2D;
  /** What `drawImage` reads from: the surface's canvas. */
  readonly image: CanvasImageSource;
}

export interface CanvasPort {
  createSurface(width: number, height: number): Surface;
  createPath(): Path2D;
  /** Decodes PNG or JPEG bytes (createImageBitmap); rejects what the platform cannot decode. */
  decodeImage(bytes: Uint8Array, mime: string): Promise<DecodedImage>;
}

/** The canvas a page is painted into, sized by the painter in device pixels. */
export interface PaintTarget {
  resize(width: number, height: number): void;
  readonly ctx: Ctx2D;
}
