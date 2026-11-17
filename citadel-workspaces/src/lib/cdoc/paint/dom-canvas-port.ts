/**
 * The canvas port's browser adapter. OffscreenCanvas where the platform has it (every current
 * browser, and the only option inside a worker); a detached <canvas> element otherwise.
 */
import { DisplayListError } from '../display-list/byte-reader';
import type { CanvasPort, Ctx2D, PaintTarget, Surface } from './canvas-port';
import type { DecodedImage } from './image-cache';

function offscreen(width: number, height: number): Surface {
  const canvas: OffscreenCanvas = new OffscreenCanvas(width, height);
  const ctx: OffscreenCanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) throw new DisplayListError('OffscreenCanvas has no 2d context');
  return { ctx, image: canvas };
}

function element(width: number, height: number): Surface {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx: Ctx2D | null = canvas.getContext('2d');
  if (ctx === null) throw new DisplayListError('<canvas> has no 2d context');
  return { ctx, image: canvas };
}

export function domCanvasPort(): CanvasPort {
  const create: (width: number, height: number) => Surface = typeof OffscreenCanvas === 'function' ? offscreen : element;
  return {
    createSurface: create,
    createPath: (): Path2D => new Path2D(),
    decodeImage: async (bytes: Uint8Array, mime: string): Promise<DecodedImage> => {
      const bitmap: ImageBitmap = await createImageBitmap(new Blob([bytes.slice()], { type: mime }));
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: (): void => bitmap.close() };
    },
  };
}

/** A page canvas as a paint target: an element on the main thread, an OffscreenCanvas in the worker. */
export function canvasTarget(canvas: HTMLCanvasElement | OffscreenCanvas): PaintTarget {
  const isElement: boolean = typeof HTMLCanvasElement === 'function' && canvas instanceof HTMLCanvasElement;
  const ctx: Ctx2D | null = isElement
    ? (canvas as HTMLCanvasElement).getContext('2d', { alpha: false })
    : (canvas as OffscreenCanvas).getContext('2d', { alpha: false });
  if (ctx === null) throw new DisplayListError('the page canvas has no 2d context');
  return {
    ctx,
    resize(width: number, height: number): void {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
  };
}
